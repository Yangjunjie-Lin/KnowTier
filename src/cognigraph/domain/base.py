"""Shared Pydantic configuration and domain primitives."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

type JsonScalar = str | int | float | bool | None
type JsonValue = JsonScalar | list[JsonValue] | dict[str, JsonValue]
type JsonObject = dict[str, JsonValue]


def utc_now() -> datetime:
    """Return an aware UTC timestamp."""

    return datetime.now(UTC)


class DomainModel(BaseModel):
    """Strict base model shared by data crossing domain boundaries."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)


def json_compatible(value: Any) -> JsonValue:
    """Convert a Pydantic-friendly value into deterministic JSON-compatible data."""

    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "hex") and value.__class__.__name__ == "UUID":
        return str(value)
    if isinstance(value, dict):
        return {str(key): json_compatible(item) for key, item in value.items()}
    if isinstance(value, list | tuple | set):
        return [json_compatible(item) for item in value]
    if isinstance(value, BaseModel):
        return json_compatible(value.model_dump(mode="json"))
    raise TypeError(f"Value of type {type(value).__name__} is not JSON compatible")
