from __future__ import annotations

import hashlib
import hmac
from collections.abc import MutableMapping

BOOTSTRAP_TOKEN_ENV = "KNOWTIER_DESKTOP_BOOTSTRAP_TOKEN"
CONTROL_TOKEN_ENV = "KNOWTIER_DESKTOP_CONTROL_TOKEN"


class OneTimeToken:
    """A verifier that retains only a digest and accepts its secret once."""

    __slots__ = ("_digest", "_used")

    def __init__(self, raw_token: str) -> None:
        if len(raw_token) < 32:
            raise ValueError("desktop control tokens must contain at least 32 characters")
        self._digest = hashlib.sha256(raw_token.encode("utf-8")).digest()
        self._used = False

    @classmethod
    def consume_environment(
        cls,
        environ: MutableMapping[str, str],
        variable: str,
    ) -> OneTimeToken:
        raw_token = environ.pop(variable, None)
        if raw_token is None:
            raise RuntimeError(f"required desktop environment variable is missing: {variable}")
        return cls(raw_token)

    @property
    def used(self) -> bool:
        return self._used

    def consume_authorization(self, authorization: str | None) -> bool:
        if self._used or authorization is None:
            return False
        scheme, separator, supplied = authorization.partition(" ")
        if separator != " " or scheme.casefold() != "bearer":
            return False
        supplied_digest = hashlib.sha256(supplied.encode("utf-8")).digest()
        if not hmac.compare_digest(self._digest, supplied_digest):
            return False
        self._used = True
        return True

    def __repr__(self) -> str:
        return f"OneTimeToken(used={self._used})"


class ProcessToken:
    """A process-scoped verifier used for the HttpOnly UI session and shutdown."""

    __slots__ = ("_digest",)

    def __init__(self, raw_token: str) -> None:
        if len(raw_token) < 32:
            raise ValueError("desktop control tokens must contain at least 32 characters")
        self._digest = hashlib.sha256(raw_token.encode("utf-8")).digest()

    @classmethod
    def consume_environment(
        cls,
        environ: MutableMapping[str, str],
        variable: str,
    ) -> ProcessToken:
        raw_token = environ.pop(variable, None)
        if raw_token is None:
            raise RuntimeError(f"required desktop environment variable is missing: {variable}")
        return cls(raw_token)

    def matches(self, supplied: str | None) -> bool:
        if supplied is None:
            return False
        supplied_digest = hashlib.sha256(supplied.encode("utf-8")).digest()
        return hmac.compare_digest(self._digest, supplied_digest)

    def matches_authorization(self, authorization: str | None) -> bool:
        if authorization is None:
            return False
        scheme, separator, supplied = authorization.partition(" ")
        return separator == " " and scheme.casefold() == "bearer" and self.matches(supplied)

    def __repr__(self) -> str:
        return "ProcessToken()"
