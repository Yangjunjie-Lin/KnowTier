from __future__ import annotations

import dataclasses
from collections.abc import Mapping
from datetime import date, datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel


def to_plain(value: Any) -> Any:
    """Convert domain/Pydantic values to stable JSON-compatible values."""
    if isinstance(value, BaseModel):
        return to_plain(value.model_dump(mode="python"))
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return to_plain(dataclasses.asdict(value))
    if isinstance(value, Mapping):
        return {str(key): to_plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [to_plain(item) for item in value]
    if isinstance(value, Enum):
        return to_plain(value.value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.hex()
    return value


def as_mapping(value: Any) -> dict[str, Any]:
    plain = to_plain(value)
    if not isinstance(plain, dict):
        raise TypeError("expected a mapping or Pydantic model")
    return plain


def enum_value(value: Any, default: str = "") -> str:
    if value is None:
        return default
    raw = value.value if isinstance(value, Enum) else value
    return str(raw)


def uuid_value(value: Any) -> UUID:
    if isinstance(value, UUID):
        return value
    return UUID(str(value))


def optional_uuid(value: Any) -> UUID | None:
    return None if value in (None, "") else uuid_value(value)


def datetime_value(value: Any, *, default: datetime | None = None) -> datetime | None:
    if value is None:
        return default
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value))
