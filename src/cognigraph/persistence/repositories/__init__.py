"""Repository implementations over the PostgreSQL system of record."""

from cognigraph.persistence.repositories.documents import DocumentRepository
from cognigraph.persistence.repositories.graph import (
    AssertionDetailRecord,
    GraphDeltaRepository,
    GraphNodeDetailRecord,
    GraphPersistenceResult,
)
from cognigraph.persistence.repositories.learners import LearnerRepository, LearnerStateRepository
from cognigraph.persistence.repositories.operations import (
    AuditRepository,
    ModelConfigRepository,
    ModelRunRepository,
    PromptRepository,
)
from cognigraph.persistence.repositories.sessions import SessionRepository, TurnRepository
from cognigraph.persistence.repositories.workspaces import WorkspaceRepository

__all__ = [
    "AssertionDetailRecord",
    "AuditRepository",
    "DocumentRepository",
    "GraphDeltaRepository",
    "GraphNodeDetailRecord",
    "GraphPersistenceResult",
    "LearnerRepository",
    "LearnerStateRepository",
    "ModelConfigRepository",
    "ModelRunRepository",
    "PromptRepository",
    "SessionRepository",
    "TurnRepository",
    "WorkspaceRepository",
]
