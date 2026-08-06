from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import SecretStr

from cognigraph.config import Settings
from cognigraph.llm.configuration import (
    SILICONFLOW_BASE_URL,
    CredentialStorage,
    ModelConfigurationService,
    ModelProfile,
    ModelProfileDraft,
    ProviderKind,
    RoleModels,
    validate_provider_base_url,
)


def settings(path: Path) -> Settings:
    return Settings(
        _env_file=None,
        environment="test",
        use_mock_llm=True,
        model_config_path=path,
    )


@pytest.mark.unit
async def test_default_mock_profile_is_visible_and_activates(tmp_path: Path) -> None:
    activated: list[ModelProfile] = []

    async def activate(profile: ModelProfile, _secret: SecretStr | None) -> None:
        activated.append(profile)

    service = ModelConfigurationService(
        settings(tmp_path / "profiles.json"),
        activate_profile=activate,
    )
    await service.initialize()
    snapshot = await service.snapshot()

    assert snapshot.active_profile_id is not None
    assert len(snapshot.profiles) == 1
    assert snapshot.profiles[0].provider is ProviderKind.MOCK
    assert snapshot.profiles[0].credential_masked is None
    assert activated[0].models.teacher == "mock/default"


@pytest.mark.unit
async def test_api_key_never_enters_profile_file_or_response(tmp_path: Path) -> None:
    async def activate(_profile: ModelProfile, _secret: SecretStr | None) -> None:
        return

    path = tmp_path / "profiles.json"
    service = ModelConfigurationService(settings(path), activate_profile=activate)
    await service.initialize()
    view = await service.create(
        ModelProfileDraft(
            name="SiliconFlow",
            provider=ProviderKind.SILICONFLOW,
            api_key=SecretStr("super-secret-contract-key"),
            models=RoleModels(
                teacher="chat",
                extractor="chat",
                grader="chat",
                graph="chat",
                vision="vision",
                embedding="embedding",
            ),
        )
    )

    serialized = path.read_text(encoding="utf-8")
    assert "super-secret-contract-key" not in serialized
    assert "api_key" not in serialized
    assert view.credential_present is True
    assert view.credential_masked == "••••••••"
    assert "super-secret-contract-key" not in view.model_dump_json()
    assert view.base_url == SILICONFLOW_BASE_URL


@pytest.mark.unit
def test_custom_base_url_requires_https_or_explicit_loopback() -> None:
    with pytest.raises(ValueError, match="HTTPS"):
        validate_provider_base_url(
            ProviderKind.CUSTOM,
            "http://models.example/v1",
            allow_local=True,
        )
    with pytest.raises(ValueError, match="explicit"):
        validate_provider_base_url(
            ProviderKind.CUSTOM,
            "http://127.0.0.1:11434/v1",
            allow_local=False,
        )
    with pytest.raises(ValueError, match="explicit"):
        validate_provider_base_url(
            ProviderKind.CUSTOM,
            "https://127.0.0.2:11434/v1",
            allow_local=False,
        )
    with pytest.raises(ValueError, match="explicit"):
        validate_provider_base_url(
            ProviderKind.CUSTOM,
            "https://models.localhost./v1",
            allow_local=False,
        )
    with pytest.raises(ValueError, match="explicit"):
        validate_provider_base_url(
            ProviderKind.CUSTOM,
            "https://[::ffff:127.0.0.1]/v1",
            allow_local=False,
        )
    with pytest.raises(ValueError, match="explicit"):
        validate_provider_base_url(
            ProviderKind.CUSTOM,
            "https://169.254.169.254/latest/meta-data",
            allow_local=False,
        )
    with pytest.raises(ValueError, match="valid URL"):
        validate_provider_base_url(
            ProviderKind.CUSTOM,
            "https://[invalid-ipv6]/v1",
            allow_local=False,
        )
    with pytest.raises(ValueError, match="explicit"):
        validate_provider_base_url(
            ProviderKind.CUSTOM,
            "https://10.0.0.4/v1",
            allow_local=False,
        )
    assert (
        validate_provider_base_url(
            ProviderKind.CUSTOM,
            "http://127.0.0.1:11434/v1",
            allow_local=True,
        )
        == "http://127.0.0.1:11434/v1"
    )
    assert (
        validate_provider_base_url(
            ProviderKind.CUSTOM,
            "https://127.0.0.2:11434/v1",
            allow_local=True,
        )
        == "https://127.0.0.2:11434/v1"
    )
    with pytest.raises(ValueError, match="credentials"):
        validate_provider_base_url(
            ProviderKind.CUSTOM,
            "https://user:password@models.example/v1",
            allow_local=False,
        )


@pytest.mark.unit
async def test_server_rejects_os_keyring_storage(tmp_path: Path) -> None:
    async def activate(_profile: ModelProfile, _secret: SecretStr | None) -> None:
        return

    service = ModelConfigurationService(
        settings(tmp_path / "profiles.json"),
        activate_profile=activate,
    )
    await service.initialize()
    with pytest.raises(ValueError, match="desktop mode"):
        await service.create(
            ModelProfileDraft(
                name="Custom",
                provider=ProviderKind.CUSTOM,
                base_url="https://models.example/v1",
                credential_storage=CredentialStorage.OS_KEYRING,
                api_key=SecretStr("session-only"),
            )
        )


@pytest.mark.unit
async def test_switching_to_mock_removes_the_previous_session_credential(
    tmp_path: Path,
) -> None:
    async def activate(_profile: ModelProfile, _secret: SecretStr | None) -> None:
        return

    service = ModelConfigurationService(
        settings(tmp_path / "profiles.json"),
        activate_profile=activate,
    )
    await service.initialize()
    external = await service.create(
        ModelProfileDraft(
            name="External",
            provider=ProviderKind.CUSTOM,
            base_url="https://models.example/v1",
            api_key=SecretStr("credential-to-remove"),
        )
    )
    await service.update(
        external.id,
        ModelProfileDraft(name="Offline", provider=ProviderKind.MOCK),
    )
    restored_external = await service.update(
        external.id,
        ModelProfileDraft(
            name="External again",
            provider=ProviderKind.CUSTOM,
            base_url="https://models.example/v1",
        ),
    )

    assert restored_external.credential_present is False
    assert "credential-to-remove" not in (tmp_path / "profiles.json").read_text(encoding="utf-8")


@pytest.mark.unit
async def test_delete_active_credential_rolls_back_on_persist_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    activated: list[tuple[ProviderKind, str | None]] = []

    async def activate(profile: ModelProfile, secret: SecretStr | None) -> None:
        activated.append(
            (
                profile.provider,
                secret.get_secret_value() if secret is not None else None,
            )
        )

    service = ModelConfigurationService(
        settings(tmp_path / "profiles.json"),
        activate_profile=activate,
    )
    await service.initialize()
    external = await service.create(
        ModelProfileDraft(
            name="Active external",
            provider=ProviderKind.CUSTOM,
            base_url="https://models.example/v1",
            api_key=SecretStr("active-credential"),
            models=RoleModels(
                teacher="chat",
                extractor="chat",
                grader="chat",
                graph="chat",
                vision="vision",
                embedding="embedding",
            ),
        )
    )
    await service.activate(external.id)

    def fail_persist() -> None:
        raise OSError("simulated profile-store failure")

    monkeypatch.setattr(service, "_persist_profiles", fail_persist)
    with pytest.raises(OSError, match="simulated profile-store failure"):
        await service.delete_credential(external.id)

    restored = await service.snapshot()
    active = next(item for item in restored.profiles if item.active)
    assert active.id == external.id
    assert active.credential_present is True
    assert activated[-1] == (ProviderKind.CUSTOM, "active-credential")
