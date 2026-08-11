from __future__ import annotations

import asyncio
import ipaddress
import json
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from enum import StrEnum
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, SecretStr

from cognigraph.config import Settings
from cognigraph.llm.openai_compatible import (
    OpenAICompatibleError,
    OpenAICompatibleProvider,
)
from cognigraph.llm.schemas import ChatMessage

SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1"
MOCK_MODEL_ID = "mock/default"


class ProviderKind(StrEnum):
    MOCK = "mock"
    SILICONFLOW = "siliconflow"
    CUSTOM = "custom_openai_compatible"


class CredentialStorage(StrEnum):
    SESSION = "session"
    OS_KEYRING = "os_keyring"


class ConnectionStatus(StrEnum):
    UNTESTED = "untested"
    CONNECTED = "connected"
    ERROR = "error"


class RoleModels(BaseModel):
    teacher: str = ""
    extractor: str = ""
    grader: str = ""
    graph: str = ""
    vision: str = ""
    embedding: str = ""

    def complete(self) -> bool:
        return all(
            value.strip()
            for value in (
                self.teacher,
                self.extractor,
                self.grader,
                self.graph,
                self.vision,
                self.embedding,
            )
        )

    @classmethod
    def mock_defaults(cls) -> RoleModels:
        return cls(
            teacher=MOCK_MODEL_ID,
            extractor=MOCK_MODEL_ID,
            grader=MOCK_MODEL_ID,
            graph=MOCK_MODEL_ID,
            vision=MOCK_MODEL_ID,
            embedding=MOCK_MODEL_ID,
        )


class ModelProfileDraft(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    provider: ProviderKind
    base_url: str | None = Field(default=None, max_length=2_000)
    allow_local: bool = False
    credential_storage: CredentialStorage = CredentialStorage.SESSION
    models: RoleModels = Field(default_factory=RoleModels)
    timeout_seconds: float = Field(default=30.0, ge=1.0, le=300.0)
    max_retries: int = Field(default=2, ge=0, le=5)
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2_048, ge=64, le=131_072)
    api_key: SecretStr | None = Field(default=None, repr=False)


class ModelProfile(BaseModel):
    id: UUID
    name: str
    provider: ProviderKind
    base_url: str | None = None
    allow_local: bool = False
    credential_storage: CredentialStorage = CredentialStorage.SESSION
    models: RoleModels
    timeout_seconds: float
    max_retries: int
    temperature: float
    max_tokens: int
    active: bool = False
    connection_status: ConnectionStatus = ConnectionStatus.UNTESTED
    last_tested_at: datetime | None = None
    error_summary: str | None = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class ModelProfileView(ModelProfile):
    credential_present: bool
    credential_masked: str | None


class ModelDiscoveryResult(BaseModel):
    profile_id: UUID
    provider: ProviderKind
    models: list[str]
    tested_at: datetime


class ModelConfigurationSnapshot(BaseModel):
    profiles: list[ModelProfileView]
    active_profile_id: UUID | None


ProfileActivator = Callable[[ModelProfile, SecretStr | None], Awaitable[None]]


class ModelConfigurationService:
    """Persist non-secret profiles and keep credentials in memory or the OS vault."""

    def __init__(
        self,
        settings: Settings,
        *,
        activate_profile: ProfileActivator,
    ) -> None:
        self.settings = settings
        self.path = settings.model_config_path
        self._activate_profile = activate_profile
        self._profiles: dict[UUID, ModelProfile] = {}
        self._session_credentials: dict[UUID, SecretStr] = {}
        self._lock = asyncio.Lock()

    async def initialize(self) -> None:
        async with self._lock:
            profiles = await asyncio.to_thread(self._load_profiles)
            self._profiles = {profile.id: profile for profile in profiles}
            if not self._profiles:
                profile = _default_mock_profile(active=self.settings.use_mock_llm)
                self._profiles[profile.id] = profile
                await asyncio.to_thread(self._persist_profiles)
            active = next((item for item in self._profiles.values() if item.active), None)
        if active is not None:
            secret = await self._credential(active)
            try:
                _validate_activatable(active, secret)
                await self._activate_profile(active, secret)
            except Exception as exc:
                async with self._lock:
                    self._profiles[active.id] = active.model_copy(
                        update={
                            "active": False,
                            "connection_status": ConnectionStatus.ERROR,
                            "error_summary": _safe_error(exc),
                            "updated_at": datetime.now(UTC),
                        }
                    )
                    await asyncio.to_thread(self._persist_profiles)

    async def snapshot(self) -> ModelConfigurationSnapshot:
        async with self._lock:
            profiles = list(self._profiles.values())
        views = [await self._view(profile) for profile in profiles]
        views.sort(key=lambda item: (not item.active, item.name.casefold(), str(item.id)))
        active_id = next((item.id for item in views if item.active), None)
        return ModelConfigurationSnapshot(profiles=views, active_profile_id=active_id)

    async def create(self, draft: ModelProfileDraft) -> ModelProfileView:
        profile = _profile_from_draft(uuid4(), draft, active=False)
        async with self._lock:
            self._profiles[profile.id] = profile
            try:
                await self._store_supplied_credential(profile, draft.api_key)
                await asyncio.to_thread(self._persist_profiles)
            except Exception:
                await self._clear_credential(profile)
                self._profiles.pop(profile.id, None)
                raise
        return await self._view(profile)

    async def update(self, profile_id: UUID, draft: ModelProfileDraft) -> ModelProfileView:
        async with self._lock:
            current = self._required(profile_id)
            previous_session_credential = self._session_credentials.get(profile_id)
            previous_keyring_credential = (
                await self._get_keyring(current.id)
                if current.credential_storage is CredentialStorage.OS_KEYRING
                else None
            )
            previous_credential = await self._credential(current)
            updated = _profile_from_draft(profile_id, draft, active=current.active).model_copy(
                update={
                    "connection_status": ConnectionStatus.UNTESTED,
                    "last_tested_at": current.last_tested_at,
                    "error_summary": None,
                }
            )
            previous = current
            self._profiles[profile_id] = updated
            supplied = draft.api_key
            target_credential = (
                None
                if updated.provider is ProviderKind.MOCK
                else supplied
                if supplied is not None and supplied.get_secret_value()
                else previous_credential
            )
            runtime_switched = False
            try:
                await self._store_supplied_credential(updated, target_credential)
                if updated.active:
                    secret = await self._credential(updated)
                    _validate_activatable(updated, secret)
                    await self._activate_profile(updated, secret)
                    runtime_switched = True
                await asyncio.to_thread(self._persist_profiles)
                if updated.provider is ProviderKind.MOCK:
                    await self._clear_credential(current)
                elif updated.credential_storage is not current.credential_storage:
                    await self._clear_credential_storage(current.id, current.credential_storage)
            except Exception:
                rollback_error: Exception | None = None
                if runtime_switched:
                    try:
                        await self._activate_profile(previous, previous_credential)
                    except Exception as exc:
                        rollback_error = exc
                self._profiles[profile_id] = previous
                await self._clear_credential(updated)
                if previous_session_credential is not None:
                    self._session_credentials[profile_id] = previous_session_credential
                if previous_keyring_credential is not None:
                    await self._set_keyring(profile_id, previous_keyring_credential)
                if rollback_error is not None:
                    raise RuntimeError("model runtime rollback failed") from rollback_error
                raise
        return await self._view(updated)

    async def activate(self, profile_id: UUID) -> ModelProfileView:
        async with self._lock:
            profile = self._required(profile_id)
            secret = await self._credential(profile)
            _validate_activatable(profile, secret)
            previous_profiles = dict(self._profiles)
            previous_active = next(
                (item for item in previous_profiles.values() if item.active), None
            )
            previous_secret = (
                await self._credential(previous_active) if previous_active is not None else None
            )
            runtime_switched = False
            try:
                await self._activate_profile(profile, secret)
                runtime_switched = True
                now = datetime.now(UTC)
                for item_id, item in tuple(self._profiles.items()):
                    self._profiles[item_id] = item.model_copy(
                        update={"active": item_id == profile_id, "updated_at": now}
                    )
                await asyncio.to_thread(self._persist_profiles)
            except Exception:
                self._profiles = previous_profiles
                if runtime_switched and previous_active is not None:
                    try:
                        await self._activate_profile(previous_active, previous_secret)
                    except Exception as exc:
                        raise RuntimeError("model runtime rollback failed") from exc
                raise
            active = self._profiles[profile_id]
        return await self._view(active)

    async def discover_models(self, profile_id: UUID) -> ModelDiscoveryResult:
        async with self._lock:
            profile = self._required(profile_id)
            secret = await self._credential(profile)
        tested_at = datetime.now(UTC)
        if profile.provider is ProviderKind.MOCK:
            models = [MOCK_MODEL_ID]
        else:
            _validate_activatable(profile, secret, require_models=False)
            if secret is None:
                raise ValueError("API credential is not available")
            provider = _external_provider(profile, secret)
            try:
                models = await provider.list_models()
            finally:
                await provider.aclose()
        return ModelDiscoveryResult(
            profile_id=profile_id,
            provider=profile.provider,
            models=models,
            tested_at=tested_at,
        )

    async def test_connection(self, profile_id: UUID) -> ModelDiscoveryResult:
        async with self._lock:
            profile = self._required(profile_id)
            secret = await self._credential(profile)
        tested_at = datetime.now(UTC)
        try:
            if profile.provider is ProviderKind.MOCK:
                models = [MOCK_MODEL_ID]
            else:
                _validate_activatable(profile, secret)
                if secret is None:
                    raise ValueError("API credential is not available")
                provider = _external_provider(
                    profile,
                    secret,
                    max_tokens=min(profile.max_tokens, 32),
                    temperature=0.0,
                )
                try:
                    models = await provider.list_models()
                    configured = set(profile.models.model_dump().values())
                    missing = sorted(configured.difference(models), key=str.casefold)
                    if missing:
                        summary = ", ".join(missing[:3])
                        raise ValueError(
                            f"configured model was not returned by GET /models: {summary}"
                        )
                    try:
                        await provider.embed(
                            model=profile.models.embedding,
                            texts=["KnowTier connection test"],
                        )
                    except OpenAICompatibleError as exc:
                        raise OpenAICompatibleError(
                            "Embedding model "
                            f"'{profile.models.embedding}' failed the connection test: {exc}",
                            status_code=exc.status_code,
                        ) from exc
                    try:
                        response = await provider.complete(
                            model=profile.models.teacher,
                            messages=[
                                ChatMessage(
                                    role="user",
                                    content="Return JSON with ok=true and no other content.",
                                )
                            ],
                            response_schema={
                                "type": "object",
                                "properties": {"ok": {"type": "boolean"}},
                                "required": ["ok"],
                                "additionalProperties": False,
                            },
                        )
                        payload = json.loads(response.content or "")
                        if not isinstance(payload, dict) or payload.get("ok") is not True:
                            raise ValueError("structured response did not contain ok=true")
                    except (json.JSONDecodeError, ValueError) as exc:
                        raise OpenAICompatibleError(
                            "Teacher model "
                            f"'{profile.models.teacher}' failed the structured-output test"
                        ) from exc
                    except OpenAICompatibleError as exc:
                        raise OpenAICompatibleError(
                            "Teacher model "
                            f"'{profile.models.teacher}' failed the connection test: {exc}",
                            status_code=exc.status_code,
                        ) from exc
                finally:
                    await provider.aclose()
        except Exception as exc:
            await self._record_test(profile_id, tested_at, error=_safe_error(exc))
            raise
        await self._record_test(profile_id, tested_at, error=None)
        return ModelDiscoveryResult(
            profile_id=profile_id,
            provider=profile.provider,
            models=models,
            tested_at=tested_at,
        )

    async def delete_credential(self, profile_id: UUID) -> ModelProfileView:
        async with self._lock:
            profile = self._required(profile_id)
            previous_profiles = dict(self._profiles)
            previous_active = next(
                (item for item in previous_profiles.values() if item.active), None
            )
            previous_secret = (
                await self._credential(previous_active) if previous_active is not None else None
            )
            previous_session_credential = self._session_credentials.get(profile_id)
            previous_keyring_credential = (
                await self._get_keyring(profile.id)
                if self.settings.desktop_mode
                or profile.credential_storage is CredentialStorage.OS_KEYRING
                else None
            )
            runtime_switched = False
            updated = profile
            try:
                if profile.active and profile.provider is not ProviderKind.MOCK:
                    fallback = next(
                        (
                            item
                            for item in self._profiles.values()
                            if item.provider is ProviderKind.MOCK
                        ),
                        None,
                    )
                    if fallback is None:
                        fallback = _default_mock_profile(active=False)
                        self._profiles[fallback.id] = fallback
                    await self._activate_profile(fallback, None)
                    runtime_switched = True
                    now = datetime.now(UTC)
                    for item_id, item in tuple(self._profiles.items()):
                        self._profiles[item_id] = item.model_copy(
                            update={"active": item_id == fallback.id, "updated_at": now}
                        )
                    profile = self._profiles[profile_id]
                await self._clear_credential(profile)
                updated = profile.model_copy(
                    update={
                        "connection_status": ConnectionStatus.UNTESTED,
                        "error_summary": None,
                        "updated_at": datetime.now(UTC),
                    }
                )
                self._profiles[profile_id] = updated
                await asyncio.to_thread(self._persist_profiles)
            except Exception:
                self._profiles = previous_profiles
                await self._clear_credential(updated)
                if previous_session_credential is not None:
                    self._session_credentials[profile_id] = previous_session_credential
                if previous_keyring_credential is not None:
                    await self._set_keyring(profile_id, previous_keyring_credential)
                if runtime_switched and previous_active is not None:
                    try:
                        await self._activate_profile(previous_active, previous_secret)
                    except Exception as exc:
                        raise RuntimeError("model runtime rollback failed") from exc
                raise
        return await self._view(updated)

    async def delete_profile(self, profile_id: UUID) -> None:
        async with self._lock:
            profile = self._required(profile_id)
            if profile.active:
                raise ValueError("the active model profile cannot be deleted")
            await self._clear_credential(profile)
            self._profiles.pop(profile_id)
            await asyncio.to_thread(self._persist_profiles)

    async def _record_test(
        self, profile_id: UUID, tested_at: datetime, *, error: str | None
    ) -> None:
        async with self._lock:
            profile = self._required(profile_id)
            self._profiles[profile_id] = profile.model_copy(
                update={
                    "connection_status": (
                        ConnectionStatus.ERROR if error else ConnectionStatus.CONNECTED
                    ),
                    "last_tested_at": tested_at,
                    "error_summary": error,
                    "updated_at": datetime.now(UTC),
                }
            )
            await asyncio.to_thread(self._persist_profiles)

    def _required(self, profile_id: UUID) -> ModelProfile:
        profile = self._profiles.get(profile_id)
        if profile is None:
            raise LookupError(f"model profile {profile_id} does not exist")
        return profile

    async def _view(self, profile: ModelProfile) -> ModelProfileView:
        credential_present = profile.provider is ProviderKind.MOCK or (
            await self._credential(profile) is not None
        )
        return ModelProfileView(
            **profile.model_dump(),
            credential_present=credential_present,
            credential_masked="••••••••"
            if credential_present and profile.provider is not ProviderKind.MOCK
            else None,
        )

    async def _store_supplied_credential(
        self, profile: ModelProfile, secret: SecretStr | None
    ) -> None:
        if secret is None or not secret.get_secret_value():
            return
        if profile.provider is ProviderKind.MOCK:
            raise ValueError("Mock Provider does not accept an API key")
        if profile.credential_storage is CredentialStorage.SESSION:
            self._session_credentials[profile.id] = secret
            return
        if not self.settings.desktop_mode:
            raise ValueError("OS credential storage is only available in desktop mode")
        await self._set_keyring(profile.id, secret)

    async def _clear_credential(self, profile: ModelProfile) -> None:
        """Remove every supported copy, including stale copies from a storage migration."""

        self._session_credentials.pop(profile.id, None)
        if self.settings.desktop_mode or profile.credential_storage is CredentialStorage.OS_KEYRING:
            await self._delete_keyring(profile.id)

    async def _clear_credential_storage(self, profile_id: UUID, storage: CredentialStorage) -> None:
        if storage is CredentialStorage.SESSION:
            self._session_credentials.pop(profile_id, None)
        else:
            await self._delete_keyring(profile_id)

    async def _credential(self, profile: ModelProfile) -> SecretStr | None:
        session = self._session_credentials.get(profile.id)
        if session is not None:
            return session
        if profile.credential_storage is CredentialStorage.OS_KEYRING:
            return await self._get_keyring(profile.id)
        return None

    async def _set_keyring(self, profile_id: UUID, secret: SecretStr) -> None:
        def store() -> None:
            import keyring

            backend = keyring.get_keyring()
            if getattr(backend, "priority", 0) <= 0:
                raise RuntimeError("no secure operating-system credential store is available")
            keyring.set_password(
                self.settings.keyring_service_name,
                str(profile_id),
                secret.get_secret_value(),
            )

        await asyncio.to_thread(store)

    async def _get_keyring(self, profile_id: UUID) -> SecretStr | None:
        def read() -> str | None:
            import keyring

            backend = keyring.get_keyring()
            if getattr(backend, "priority", 0) <= 0:
                return None
            return keyring.get_password(self.settings.keyring_service_name, str(profile_id))

        value = await asyncio.to_thread(read)
        return SecretStr(value) if value else None

    async def _delete_keyring(self, profile_id: UUID) -> None:
        def delete() -> None:
            import keyring
            from keyring.errors import KeyringError, PasswordDeleteError

            try:
                keyring.delete_password(self.settings.keyring_service_name, str(profile_id))
            except (PasswordDeleteError, KeyringError):
                return

        await asyncio.to_thread(delete)

    def _load_profiles(self) -> list[ModelProfile]:
        if self.path is None:
            return []
        if not self.path.exists():
            return []
        candidates = (self.path, self.path.with_suffix(self.path.suffix + ".bak"))
        for candidate in candidates:
            if not candidate.exists():
                continue
            try:
                raw = json.loads(candidate.read_text(encoding="utf-8"))
                if not isinstance(raw, list):
                    continue
                return [ModelProfile.model_validate(item) for item in raw]
            except (OSError, ValueError, TypeError):
                continue
        raise RuntimeError("model profile store and backup are unreadable")

    def _persist_profiles(self) -> None:
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(
            [
                profile.model_dump(mode="json")
                for profile in sorted(self._profiles.values(), key=lambda item: str(item.id))
            ],
            ensure_ascii=False,
            indent=2,
        )
        if "api_key" in payload.casefold():
            raise RuntimeError("refusing to persist a secret-bearing model profile")
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        backup = self.path.with_suffix(self.path.suffix + ".bak")
        temporary.write_text(payload + "\n", encoding="utf-8")
        if self.path.exists():
            backup.write_bytes(self.path.read_bytes())
        temporary.replace(self.path)


def validate_provider_base_url(
    provider: ProviderKind, base_url: str | None, *, allow_local: bool
) -> str | None:
    if provider is ProviderKind.MOCK:
        if base_url not in (None, ""):
            raise ValueError("Mock Provider does not use a Base URL")
        return None
    value = base_url or SILICONFLOW_BASE_URL if provider is ProviderKind.SILICONFLOW else base_url
    if not value:
        raise ValueError("Base URL is required")
    try:
        parsed = urlsplit(value.strip())
        hostname = (parsed.hostname or "").casefold()
    except ValueError as exc:
        raise ValueError("Base URL must be a valid URL") from exc
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Base URL cannot contain credentials, query parameters, or fragments")
    is_local = _is_local_hostname(hostname)
    if is_local and not (provider is ProviderKind.CUSTOM and allow_local):
        raise ValueError("Local Base URLs require explicit local-provider opt-in")
    if parsed.scheme.casefold() != "https":
        if not (
            provider is ProviderKind.CUSTOM
            and allow_local
            and is_local
            and parsed.scheme.casefold() == "http"
        ):
            raise ValueError("Base URL must use HTTPS; local HTTP requires explicit opt-in")
    if not hostname:
        raise ValueError("Base URL must include a hostname")
    return value.strip().rstrip("/")


def _is_local_hostname(hostname: str) -> bool:
    normalized = hostname.rstrip(".")
    if normalized == "localhost" or normalized.endswith(".localhost"):
        return True
    try:
        address = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    if (
        address.is_loopback
        or address.is_unspecified
        or address.is_private
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or not address.is_global
    ):
        return True
    mapped = getattr(address, "ipv4_mapped", None)
    return bool(
        mapped
        and (
            mapped.is_loopback
            or mapped.is_unspecified
            or mapped.is_private
            or mapped.is_link_local
            or mapped.is_reserved
            or mapped.is_multicast
            or not mapped.is_global
        )
    )


def _profile_from_draft(
    profile_id: UUID, draft: ModelProfileDraft, *, active: bool
) -> ModelProfile:
    base_url = validate_provider_base_url(
        draft.provider, draft.base_url, allow_local=draft.allow_local
    )
    models = RoleModels.mock_defaults() if draft.provider is ProviderKind.MOCK else draft.models
    if (
        draft.provider is ProviderKind.MOCK
        and draft.credential_storage is not CredentialStorage.SESSION
    ):
        raise ValueError("Mock Provider does not use OS credential storage")
    return ModelProfile(
        id=profile_id,
        name=draft.name.strip(),
        provider=draft.provider,
        base_url=base_url,
        allow_local=draft.allow_local,
        credential_storage=draft.credential_storage,
        models=models,
        timeout_seconds=draft.timeout_seconds,
        max_retries=draft.max_retries,
        temperature=draft.temperature,
        max_tokens=draft.max_tokens,
        active=active,
        updated_at=datetime.now(UTC),
    )


def _validate_activatable(
    profile: ModelProfile,
    secret: SecretStr | None,
    *,
    require_models: bool = True,
) -> None:
    validate_provider_base_url(profile.provider, profile.base_url, allow_local=profile.allow_local)
    if require_models and not profile.models.complete():
        raise ValueError("all six model roles must be configured before activation")
    if profile.provider is not ProviderKind.MOCK and secret is None:
        raise ValueError("API credential is not available")


def _external_provider(
    profile: ModelProfile,
    secret: SecretStr,
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> OpenAICompatibleProvider:
    if profile.base_url is None:
        raise ValueError("Base URL is required")
    return OpenAICompatibleProvider(
        provider_name=profile.provider.value,
        base_url=profile.base_url,
        api_key=secret,
        timeout_seconds=profile.timeout_seconds,
        max_retries=profile.max_retries,
        temperature=profile.temperature if temperature is None else temperature,
        max_tokens=profile.max_tokens if max_tokens is None else max_tokens,
        request_embedding_dimensions=profile.provider is not ProviderKind.SILICONFLOW,
    )


def _default_mock_profile(*, active: bool) -> ModelProfile:
    return ModelProfile(
        id=uuid4(),
        name="Mock Provider",
        provider=ProviderKind.MOCK,
        models=RoleModels.mock_defaults(),
        timeout_seconds=30.0,
        max_retries=0,
        temperature=0.0,
        max_tokens=2_048,
        active=active,
    )


def _safe_error(error: Exception) -> str:
    text = str(error).strip() or type(error).__name__
    return text.replace("\r", " ").replace("\n", " ")[:240]
