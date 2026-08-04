"""Structural interface shared by Neo4j and in-memory graph repositories."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from .models import GraphApplyResult, GraphDeltaInput, GraphRecord


class GraphRepository(Protocol):
    async def create_schema(self) -> None: ...

    async def is_ready(self) -> bool: ...

    async def close(self) -> None: ...

    async def apply_delta(
        self,
        delta: GraphDeltaInput,
        revision_id: str | None = None,
        *,
        application_id: str | None = None,
    ) -> GraphApplyResult: ...

    async def search_knowledge_points(
        self, workspace_id: str, query: str, *, limit: int = 20
    ) -> GraphRecord: ...

    async def get_graph_manifest(self, workspace_id: str) -> GraphRecord: ...

    async def get_node_detail(self, workspace_id: str, node_id: str) -> GraphRecord | None: ...

    async def get_relation_assertion_detail(
        self, workspace_id: str, assertion_id: str
    ) -> GraphRecord | None: ...

    async def get_prerequisite_chain(
        self, workspace_id: str, node_id: str, *, max_depth: int = 3, limit: int = 100
    ) -> GraphRecord: ...

    async def get_related_theories(
        self, workspace_id: str, node_id: str, *, limit: int = 20
    ) -> GraphRecord: ...

    async def get_learning_path(
        self,
        workspace_id: str,
        target_node_id: str,
        *,
        learner_id: str | None = None,
        max_depth: int = 3,
        limit: int = 100,
    ) -> GraphRecord: ...

    async def get_learner_state(
        self,
        workspace_id: str,
        learner_id: str,
        *,
        knowledge_point_ids: Sequence[str] = (),
        limit: int = 100,
    ) -> GraphRecord: ...

    async def get_supporting_sources(
        self, workspace_id: str, entity_id: str, *, limit: int = 20
    ) -> GraphRecord: ...

    async def get_focus_subgraph(
        self,
        workspace_id: str,
        node_ids: Sequence[str],
        *,
        max_depth: int = 2,
        max_nodes: int = 100,
    ) -> GraphRecord: ...
