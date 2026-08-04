"""Errors raised by the semantic graph projection repositories."""

from __future__ import annotations


class GraphRepositoryError(RuntimeError):
    """Base error for graph projection operations."""


class GraphPayloadError(GraphRepositoryError, ValueError):
    """Raised when a graph delta cannot be applied safely."""


class GraphRevisionConflict(GraphRepositoryError):
    """Raised when a delta is based on a stale graph revision."""

    def __init__(self, expected: str | None, actual: str | None) -> None:
        self.expected = expected
        self.actual = actual
        super().__init__(
            f"graph revision conflict: delta expects {expected!r}, current revision is {actual!r}"
        )


class GraphUnavailableError(GraphRepositoryError):
    """Raised when Neo4j cannot serve graph requests."""
