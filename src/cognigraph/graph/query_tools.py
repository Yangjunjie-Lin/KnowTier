"""Fixed-schema, bounded graph query tools for model and API callers."""

from __future__ import annotations

import json
from collections import deque
from collections.abc import Awaitable, Callable, Sequence
from contextvars import ContextVar
from datetime import datetime
from threading import Lock, local
from time import perf_counter
from typing import Any, Protocol, cast
from uuid import UUID, uuid4

from pydantic import Field

from cognigraph.domain.base import DomainModel, JsonObject, JsonValue, json_compatible, utc_now
from cognigraph.domain.enums import NodeType, RelationTypeKey
from cognigraph.domain.graph import RelationAssertion
from cognigraph.graph.applier import GraphNode, GraphSnapshot
from cognigraph.graph.manifest import GraphManifestService
from cognigraph.llm.schemas import ToolCall, ToolDefinition, ToolResult


class WorkspaceParams(DomainModel):
    workspace_id: UUID


class SearchKnowledgePointsParams(WorkspaceParams):
    workspace_id: UUID
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=10, ge=1, le=50)


class NodeDetailParams(WorkspaceParams):
    node_id: UUID


class AssertionDetailParams(WorkspaceParams):
    assertion_id: UUID


class PrerequisiteChainParams(WorkspaceParams):
    knowledge_point_id: UUID
    max_depth: int = Field(default=3, ge=1, le=5)
    max_nodes: int = Field(default=50, ge=1, le=100)


class RelatedTheoriesParams(WorkspaceParams):
    knowledge_point_id: UUID
    limit: int = Field(default=20, ge=1, le=50)


class LearningPathParams(WorkspaceParams):
    target_knowledge_point_id: UUID
    learner_id: UUID | None = None
    max_depth: int = Field(default=5, ge=1, le=5)
    max_nodes: int = Field(default=50, ge=1, le=100)


class LearnerStateParams(WorkspaceParams):
    learner_id: UUID
    knowledge_point_id: UUID | None = None
    limit: int = Field(default=50, ge=1, le=100)


class SupportingSourcesParams(WorkspaceParams):
    entity_id: UUID
    limit: int = Field(default=20, ge=1, le=50)


class FocusSubgraphParams(WorkspaceParams):
    node_id: UUID
    max_depth: int = Field(default=2, ge=1, le=3)
    max_nodes: int = Field(default=50, ge=1, le=100)


# The registry is deliberately static: model output can select only one of
# these names, and each name is bound to a closed Pydantic parameter model.
GRAPH_TOOL_PARAMETER_MODELS: dict[str, type[WorkspaceParams]] = {
    "search_knowledge_points": SearchKnowledgePointsParams,
    "get_graph_manifest": WorkspaceParams,
    "get_node_detail": NodeDetailParams,
    "get_relation_assertion_detail": AssertionDetailParams,
    "get_prerequisite_chain": PrerequisiteChainParams,
    "get_related_theories": RelatedTheoriesParams,
    "get_learning_path": LearningPathParams,
    "get_learner_state": LearnerStateParams,
    "get_supporting_sources": SupportingSourcesParams,
    "get_focus_subgraph": FocusSubgraphParams,
}

GRAPH_TOOL_DESCRIPTIONS: dict[str, str] = {
    "search_knowledge_points": "Search bounded, source-backed knowledge points by name or summary.",
    "get_graph_manifest": "Read the revision-keyed global graph manifest.",
    "get_node_detail": "Read one knowledge graph node and its bounded relationships.",
    "get_relation_assertion_detail": (
        "Read one relation assertion, evidence, and supersession state."
    ),
    "get_prerequisite_chain": "Read a bounded prerequisite chain for a knowledge point.",
    "get_related_theories": "Read theories related to a knowledge point.",
    "get_learning_path": "Read a bounded deterministic prerequisite learning path.",
    "get_learner_state": "Read the requesting learner's mastery state.",
    "get_supporting_sources": "Read source spans supporting a node or assertion.",
    "get_focus_subgraph": "Read a bounded neighborhood around one graph node.",
}


def graph_tool_definitions() -> list[ToolDefinition]:
    """Return deterministic provider-neutral declarations for graph reads."""

    return [
        ToolDefinition(
            name=name,
            description=GRAPH_TOOL_DESCRIPTIONS[name],
            parameters=model.model_json_schema(),
        )
        for name, model in GRAPH_TOOL_PARAMETER_MODELS.items()
    ]


class QueryResult(DomainModel):
    workspace_id: UUID
    graph_revision_id: UUID | None
    data: JsonObject


class ToolCallRecord(DomainModel):
    id: UUID = Field(default_factory=uuid4)
    tool_name: str
    workspace_id: UUID
    parameters: JsonObject
    graph_revision_id: UUID | None
    learner_id: UUID | None = None
    session_id: UUID | None = None
    model_run_id: UUID | None = None
    result_count: int = Field(default=0, ge=0)
    latency_ms: int = Field(default=0, ge=0)
    result_bytes: int = Field(default=0, ge=0)
    truncated: bool = False
    tool_step: int = Field(default=0, ge=0)
    status: str = Field(default="SUCCEEDED", min_length=1, max_length=32)
    created_at: datetime = Field(default_factory=utc_now)


class ToolAuditSink(Protocol):
    def record(self, call: ToolCallRecord) -> None:
        """Persist or emit a sanitized tool call record."""


class InMemoryToolAuditSink:
    def __init__(self) -> None:
        self._records: list[ToolCallRecord] = []
        self._lock = Lock()

    def record(self, call: ToolCallRecord) -> None:
        with self._lock:
            self._records.append(call.model_copy(deep=True))

    @property
    def records(self) -> list[ToolCallRecord]:
        with self._lock:
            return [record.model_copy(deep=True) for record in self._records]


class BufferedToolAuditSink:
    """A process-local, thread-safe handoff buffer for async SQL persistence."""

    def __init__(self) -> None:
        self._records: deque[ToolCallRecord] = deque()
        self._lock = Lock()

    def record(self, call: ToolCallRecord) -> None:
        with self._lock:
            self._records.append(call.model_copy(deep=True))

    def drain(self, *, limit: int = 100) -> list[ToolCallRecord]:
        if limit < 1:
            raise ValueError("limit must be positive")
        with self._lock:
            return [self._records.popleft() for _ in range(min(limit, len(self._records)))]

    def requeue_front(self, records: Sequence[ToolCallRecord]) -> None:
        with self._lock:
            for record in reversed(records):
                self._records.appendleft(record.model_copy(deep=True))

    @property
    def pending_count(self) -> int:
        with self._lock:
            return len(self._records)


class AsyncGraphQueryProvider(Protocol):
    """Fixed semantic graph reads implemented by Neo4j and the offline repository."""

    async def search_knowledge_points(
        self, workspace_id: str, query: str, *, limit: int = 20
    ) -> dict[str, Any]: ...

    async def get_graph_manifest(self, workspace_id: str) -> dict[str, Any]: ...

    async def get_node_detail(self, workspace_id: str, node_id: str) -> dict[str, Any] | None: ...

    async def get_relation_assertion_detail(
        self, workspace_id: str, assertion_id: str
    ) -> dict[str, Any] | None: ...

    async def get_prerequisite_chain(
        self, workspace_id: str, node_id: str, *, max_depth: int = 3, limit: int = 100
    ) -> dict[str, Any]: ...

    async def get_related_theories(
        self, workspace_id: str, node_id: str, *, limit: int = 20
    ) -> dict[str, Any]: ...

    async def get_learning_path(
        self,
        workspace_id: str,
        target_node_id: str,
        *,
        learner_id: str | None = None,
        max_depth: int = 3,
        limit: int = 100,
    ) -> dict[str, Any]: ...

    async def get_learner_state(
        self,
        workspace_id: str,
        learner_id: str,
        *,
        knowledge_point_ids: Sequence[str] = (),
        limit: int = 100,
    ) -> dict[str, Any]: ...

    async def get_supporting_sources(
        self, workspace_id: str, entity_id: str, *, limit: int = 20
    ) -> dict[str, Any]: ...

    async def get_focus_subgraph(
        self,
        workspace_id: str,
        node_ids: Sequence[str],
        *,
        max_depth: int = 2,
        max_nodes: int = 100,
    ) -> dict[str, Any]: ...


LearnerStateLoader = Callable[[LearnerStateParams], Awaitable[dict[str, Any]]]


class AsyncControlledGraphQueryTools:
    """Async fixed-schema facade over the production semantic graph projection."""

    def __init__(
        self,
        provider: AsyncGraphQueryProvider,
        audit_sink: ToolAuditSink | None = None,
        learner_state_loader: LearnerStateLoader | None = None,
    ) -> None:
        self._provider = provider
        self._audit = audit_sink or InMemoryToolAuditSink()
        self._learner_state_loader = learner_state_loader
        self._suppress_audit: ContextVar[bool] = ContextVar(
            "async_graph_query_suppress_audit", default=False
        )

    async def execute_tool(self, call: ToolCall, *, context: object | None = None) -> ToolResult:
        """Execute one registered read using a closed parameter schema.

        The gateway performs request-context authorization and budget checks;
        this second validation layer protects callers that invoke the facade
        directly.
        """

        parameter_model = GRAPH_TOOL_PARAMETER_MODELS.get(call.name)
        if parameter_model is None:
            raise KeyError(f"unknown graph tool: {call.name}")
        params = parameter_model.model_validate(call.arguments)
        _authorize_query_context(params, context)
        method = getattr(self, call.name, None)
        if method is None:
            raise KeyError(f"graph tool {call.name} is not implemented")
        token = self._suppress_audit.set(True)
        try:
            result = await method(params)
            return _tool_result(result, call)
        finally:
            self._suppress_audit.reset(token)

    async def search_knowledge_points(self, params: SearchKnowledgePointsParams) -> QueryResult:
        return await self._execute(
            "search_knowledge_points",
            params,
            lambda: self._provider.search_knowledge_points(
                str(params.workspace_id), params.query, limit=params.limit
            ),
        )

    async def get_graph_manifest(self, params: WorkspaceParams) -> QueryResult:
        return await self._execute(
            "get_graph_manifest",
            params,
            lambda: self._provider.get_graph_manifest(str(params.workspace_id)),
        )

    async def get_node_detail(self, params: NodeDetailParams) -> QueryResult:
        return await self._execute(
            "get_node_detail",
            params,
            lambda: self._provider.get_node_detail(str(params.workspace_id), str(params.node_id)),
        )

    async def get_relation_assertion_detail(self, params: AssertionDetailParams) -> QueryResult:
        return await self._execute(
            "get_relation_assertion_detail",
            params,
            lambda: self._provider.get_relation_assertion_detail(
                str(params.workspace_id), str(params.assertion_id)
            ),
        )

    async def get_prerequisite_chain(self, params: PrerequisiteChainParams) -> QueryResult:
        return await self._execute(
            "get_prerequisite_chain",
            params,
            lambda: self._provider.get_prerequisite_chain(
                str(params.workspace_id),
                str(params.knowledge_point_id),
                max_depth=params.max_depth,
                limit=params.max_nodes,
            ),
        )

    async def get_related_theories(self, params: RelatedTheoriesParams) -> QueryResult:
        return await self._execute(
            "get_related_theories",
            params,
            lambda: self._provider.get_related_theories(
                str(params.workspace_id),
                str(params.knowledge_point_id),
                limit=params.limit,
            ),
        )

    async def get_learning_path(self, params: LearningPathParams) -> QueryResult:
        return await self._execute(
            "get_learning_path",
            params,
            lambda: self._learning_path_with_learner_state(params),
        )

    async def get_learner_state(self, params: LearnerStateParams) -> QueryResult:
        loader = self._learner_state_loader
        if loader is not None:
            return await self._execute(
                "get_learner_state",
                params,
                lambda: loader(params),
            )
        knowledge_point_ids = (
            [str(params.knowledge_point_id)] if params.knowledge_point_id is not None else []
        )
        return await self._execute(
            "get_learner_state",
            params,
            lambda: self._provider.get_learner_state(
                str(params.workspace_id),
                str(params.learner_id),
                knowledge_point_ids=knowledge_point_ids,
                limit=params.limit,
            ),
        )

    async def _learning_path_with_learner_state(
        self,
        params: LearningPathParams,
    ) -> dict[str, Any]:
        path = await self._provider.get_learning_path(
            str(params.workspace_id),
            str(params.target_knowledge_point_id),
            learner_id=str(params.learner_id) if params.learner_id else None,
            max_depth=params.max_depth,
            limit=params.max_nodes,
        )
        if params.learner_id is None or self._learner_state_loader is None:
            return path
        state = await self._learner_state_loader(
            LearnerStateParams(
                workspace_id=params.workspace_id,
                learner_id=params.learner_id,
                limit=params.max_nodes,
            )
        )
        path_revision = _optional_uuid(path.get("revision_id"))
        state_revision = _optional_uuid(state.get("revision_id"))
        if path_revision != state_revision:
            raise ValueError("learner state and semantic path revisions do not match")
        result = dict(path)
        items = state.get("items", [])
        result["learner_states"] = items if isinstance(items, list) else []
        learner_revision = state.get("learner_graph_revision_id")
        if learner_revision is not None:
            result["learner_graph_revision_id"] = learner_revision
        return result

    async def get_supporting_sources(self, params: SupportingSourcesParams) -> QueryResult:
        return await self._execute(
            "get_supporting_sources",
            params,
            lambda: self._provider.get_supporting_sources(
                str(params.workspace_id), str(params.entity_id), limit=params.limit
            ),
        )

    async def get_focus_subgraph(self, params: FocusSubgraphParams) -> QueryResult:
        return await self._execute(
            "get_focus_subgraph",
            params,
            lambda: self._provider.get_focus_subgraph(
                str(params.workspace_id),
                [str(params.node_id)],
                max_depth=params.max_depth,
                max_nodes=params.max_nodes,
            ),
        )

    async def _execute(
        self,
        name: str,
        params: WorkspaceParams,
        operation: Callable[[], Awaitable[dict[str, Any] | None]],
    ) -> QueryResult:
        started_at = perf_counter()
        try:
            raw = await operation()
            if raw is None:
                raise KeyError(f"{name} target was not found")
            raw_workspace_id = raw.get("workspace_id")
            if raw_workspace_id is not None and UUID(str(raw_workspace_id)) != params.workspace_id:
                raise ValueError("graph provider returned a different workspace")
            revision_id = _optional_uuid(raw.get("revision_id"))
            normalized = json_compatible(raw)
            if not isinstance(normalized, dict):
                raise TypeError("graph provider returned a non-object result")
            result = QueryResult(
                workspace_id=params.workspace_id,
                graph_revision_id=revision_id,
                data=normalized,
            )
        except Exception:
            self._record(
                name,
                params,
                graph_revision_id=None,
                result_count=0,
                result_bytes=0,
                truncated=False,
                latency_ms=_elapsed_ms(started_at),
                status="FAILED",
            )
            raise
        self._record(
            name,
            params,
            graph_revision_id=result.graph_revision_id,
            result_count=_result_count(result.data),
            result_bytes=_json_bytes(result.data),
            truncated=False,
            latency_ms=_elapsed_ms(started_at),
            status="SUCCEEDED",
        )
        return result

    def _record(
        self,
        name: str,
        params: WorkspaceParams,
        *,
        graph_revision_id: UUID | None,
        result_count: int,
        result_bytes: int,
        truncated: bool,
        latency_ms: int,
        status: str,
    ) -> None:
        if not self._suppress_audit.get():
            self._audit.record(
                ToolCallRecord(
                    tool_name=name,
                    workspace_id=params.workspace_id,
                    parameters=_sanitized_parameters(params.model_dump(mode="json")),
                    graph_revision_id=graph_revision_id,
                    learner_id=_learner_id(params),
                    result_count=result_count,
                    result_bytes=result_bytes,
                    truncated=truncated,
                    latency_ms=latency_ms,
                    status=status,
                )
            )


class GraphSnapshotProvider(Protocol):
    def get_snapshot(self, workspace_id: UUID) -> GraphSnapshot:
        """Return the current workspace projection."""


class ControlledGraphQueryTools:
    """Only named, parameterized operations; deliberately no raw query entry point."""

    def __init__(
        self,
        provider: GraphSnapshotProvider,
        audit_sink: ToolAuditSink | None = None,
        manifest_service: GraphManifestService | None = None,
    ) -> None:
        self._provider = provider
        self._audit = audit_sink or InMemoryToolAuditSink()
        self._manifest = manifest_service or GraphManifestService()
        self._timing = local()
        self._suppress_audit: ContextVar[bool] = ContextVar(
            "sync_graph_query_suppress_audit", default=False
        )

    async def execute_tool(self, call: ToolCall, *, context: object | None = None) -> ToolResult:
        """Async adapter around the deterministic in-memory query facade."""

        parameter_model = GRAPH_TOOL_PARAMETER_MODELS.get(call.name)
        if parameter_model is None:
            raise KeyError(f"unknown graph tool: {call.name}")
        params = parameter_model.model_validate(call.arguments)
        _authorize_query_context(params, context)
        method = getattr(self, call.name, None)
        if method is None:
            raise KeyError(f"graph tool {call.name} is not implemented")
        token = self._suppress_audit.set(True)
        try:
            result = method(params)
            return _tool_result(result, call)
        finally:
            self._suppress_audit.reset(token)

    def search_knowledge_points(self, params: SearchKnowledgePointsParams) -> QueryResult:
        snapshot = self._snapshot(params.workspace_id)
        terms = [term for term in params.query.casefold().split() if term]
        matches: list[tuple[int, str, GraphNode]] = []
        for node in snapshot.nodes:
            if node.node_type is not NodeType.KNOWLEDGE_POINT:
                continue
            searchable = " ".join(
                text
                for text in (
                    _property_text(node, "canonical_name"),
                    _property_text(node, "display_name"),
                    _property_text(node, "summary"),
                    _property_list_text(node, "aliases"),
                )
                if text
            ).casefold()
            score = sum(searchable.count(term) for term in terms)
            if score:
                matches.append((score, _node_name(node), node))
        matches.sort(key=lambda item: (-item[0], item[1].casefold(), str(item[2].id)))
        data: JsonObject = {
            "items": [
                {"id": str(node.id), "name": name, "score": score}
                for score, name, node in matches[: params.limit]
            ]
        }
        return self._result("search_knowledge_points", params, snapshot, data)

    def get_graph_manifest(self, params: WorkspaceParams) -> QueryResult:
        snapshot = self._snapshot(params.workspace_id)
        manifest = self._manifest.build(snapshot)
        return self._result(
            "get_graph_manifest", params, snapshot, manifest.model_dump(mode="json")
        )

    def get_node_detail(self, params: NodeDetailParams) -> QueryResult:
        snapshot = self._snapshot(params.workspace_id)
        node = _require_node(snapshot, params.node_id)
        incoming = [item for item in snapshot.assertions if item.object_id == node.id]
        outgoing = [item for item in snapshot.assertions if item.subject_id == node.id]
        sources = _source_data(snapshot, node.source_span_ids)
        node_map = snapshot.node_map()
        active_adjacent = [item for item in [*incoming, *outgoing] if item.is_active]
        theory_ids = {
            endpoint
            for assertion in active_adjacent
            for endpoint in (assertion.subject_id, assertion.object_id)
            if endpoint != node.id
            and endpoint in node_map
            and node_map[endpoint].node_type is NodeType.THEORY
        }
        related_knowledge_ids = {
            endpoint
            for assertion in active_adjacent
            for endpoint in (assertion.subject_id, assertion.object_id)
            if endpoint != node.id
            and endpoint in node_map
            and node_map[endpoint].node_type is NodeType.KNOWLEDGE_POINT
        }
        prerequisite_ids = {
            item.object_id
            for item in outgoing
            if item.is_active and item.predicate_key is RelationTypeKey.REQUIRES
        }
        learning_stages = [
            item
            for item in snapshot.nodes
            if item.node_type is NodeType.LEARNING_STAGE
            and _property_text(item, "knowledge_point_id") == str(node.id)
        ]
        data: JsonObject = {
            "node": node.model_dump(mode="json"),
            "natural_language_definition": (
                _property_text(node, "plain_language_definition")
                or _property_text(node, "summary")
                or _property_text(node, "description")
            ),
            "theories": [
                node_map[item].model_dump(mode="json") for item in sorted(theory_ids, key=str)
            ],
            "prerequisites": [
                node_map[item].model_dump(mode="json")
                for item in sorted(prerequisite_ids, key=str)
                if item in node_map
            ],
            "related_knowledge_points": [
                node_map[item].model_dump(mode="json")
                for item in sorted(related_knowledge_ids, key=str)
            ],
            "learning_stages": [
                item.model_dump(mode="json")
                for item in sorted(
                    learning_stages,
                    key=lambda stage: _integer_property(stage, "cognitive_level"),
                )
            ],
            "incoming_assertions": _assertion_summaries(incoming),
            "outgoing_assertions": _assertion_summaries(outgoing),
            "sources": sources,
            "graph_revision": str(snapshot.revision_id) if snapshot.revision_id else None,
        }
        return self._result("get_node_detail", params, snapshot, data)

    def get_relation_assertion_detail(self, params: AssertionDetailParams) -> QueryResult:
        snapshot = self._snapshot(params.workspace_id)
        assertion = _require_assertion(snapshot, params.assertion_id)
        relation_type = next(
            (
                item
                for item in snapshot.relation_types
                if item.id == assertion.relation_type_id or item.name is assertion.predicate_key
            ),
            None,
        )
        superseding = next(
            (item for item in snapshot.assertions if item.supersedes_assertion_id == assertion.id),
            None,
        )
        data: JsonObject = {
            "assertion": assertion.model_dump(mode="json"),
            "subject": _require_node(snapshot, assertion.subject_id).model_dump(mode="json"),
            "object": _require_node(snapshot, assertion.object_id).model_dump(mode="json"),
            "relation_type": (
                relation_type.model_dump(mode="json")
                if relation_type is not None
                else {"name": assertion.predicate_key.value}
            ),
            "sources": _source_data(snapshot, assertion.source_span_ids),
            "conflicts": _conflicts(snapshot, assertion),
            "superseded_relation": _superseded_data(snapshot, assertion),
            "superseding_relation": (
                superseding.model_dump(mode="json") if superseding is not None else None
            ),
            "graph_revision": str(assertion.graph_revision_id),
        }
        return self._result("get_relation_assertion_detail", params, snapshot, data)

    def get_prerequisite_chain(self, params: PrerequisiteChainParams) -> QueryResult:
        snapshot = self._snapshot(params.workspace_id)
        _require_node(snapshot, params.knowledge_point_id)
        node_ids, assertions = _bounded_walk(
            snapshot,
            params.knowledge_point_id,
            predicates={RelationTypeKey.REQUIRES},
            max_depth=params.max_depth,
            max_nodes=params.max_nodes,
            direction="outgoing",
        )
        data = _subgraph_data(snapshot, node_ids, assertions)
        return self._result("get_prerequisite_chain", params, snapshot, data)

    def get_related_theories(self, params: RelatedTheoriesParams) -> QueryResult:
        snapshot = self._snapshot(params.workspace_id)
        _require_node(snapshot, params.knowledge_point_id)
        adjacent = _adjacent_assertions(snapshot, params.knowledge_point_id)
        theory_ids = {
            endpoint
            for assertion in adjacent
            for endpoint in (assertion.subject_id, assertion.object_id)
            if endpoint != params.knowledge_point_id
            and _require_node(snapshot, endpoint).node_type is NodeType.THEORY
        }
        theories = sorted(
            (_require_node(snapshot, node_id) for node_id in theory_ids),
            key=lambda node: (_node_name(node).casefold(), str(node.id)),
        )[: params.limit]
        return self._result(
            "get_related_theories",
            params,
            snapshot,
            {"items": [node.model_dump(mode="json") for node in theories]},
        )

    def get_learning_path(self, params: LearningPathParams) -> QueryResult:
        snapshot = self._snapshot(params.workspace_id)
        _require_node(snapshot, params.target_knowledge_point_id)
        node_ids, assertions = _bounded_walk(
            snapshot,
            params.target_knowledge_point_id,
            predicates={RelationTypeKey.REQUIRES},
            max_depth=params.max_depth,
            max_nodes=params.max_nodes,
            direction="outgoing",
        )
        ordered = _topological_prerequisites(snapshot, node_ids, assertions)
        data: JsonObject = {
            "knowledge_point_ids": [str(node_id) for node_id in ordered],
            "learner_id": str(params.learner_id) if params.learner_id else None,
        }
        return self._result("get_learning_path", params, snapshot, data)

    def get_learner_state(self, params: LearnerStateParams) -> QueryResult:
        snapshot = self._snapshot(params.workspace_id)
        states = [
            node
            for node in snapshot.nodes
            if node.node_type is NodeType.LEARNER_KNOWLEDGE_STATE
            and _property_text(node, "learner_id") == str(params.learner_id)
            and (
                params.knowledge_point_id is None
                or _property_text(node, "knowledge_point_id") == str(params.knowledge_point_id)
            )
        ]
        states.sort(key=lambda node: str(node.id))
        return self._result(
            "get_learner_state",
            params,
            snapshot,
            {"items": [node.model_dump(mode="json") for node in states[: params.limit]]},
        )

    def get_supporting_sources(self, params: SupportingSourcesParams) -> QueryResult:
        snapshot = self._snapshot(params.workspace_id)
        node = next((item for item in snapshot.nodes if item.id == params.entity_id), None)
        assertion = next(
            (item for item in snapshot.assertions if item.id == params.entity_id), None
        )
        if node is None and assertion is None:
            raise KeyError(f"entity {params.entity_id} was not found")
        if node is not None:
            source_ids = node.source_span_ids
        elif assertion is not None:
            source_ids = assertion.source_span_ids
        else:
            raise KeyError(f"entity {params.entity_id} was not found")
        data: JsonObject = {"items": _source_data(snapshot, source_ids)[: params.limit]}
        return self._result("get_supporting_sources", params, snapshot, data)

    def get_focus_subgraph(self, params: FocusSubgraphParams) -> QueryResult:
        snapshot = self._snapshot(params.workspace_id)
        _require_node(snapshot, params.node_id)
        node_ids, assertions = _bounded_walk(
            snapshot,
            params.node_id,
            predicates=None,
            max_depth=params.max_depth,
            max_nodes=params.max_nodes,
            direction="both",
        )
        return self._result(
            "get_focus_subgraph", params, snapshot, _subgraph_data(snapshot, node_ids, assertions)
        )

    def _snapshot(self, workspace_id: UUID) -> GraphSnapshot:
        self._timing.started_at = perf_counter()
        snapshot = self._provider.get_snapshot(workspace_id)
        if snapshot.workspace_id != workspace_id:
            raise ValueError("graph provider returned a different workspace")
        return snapshot

    def _result(
        self,
        name: str,
        params: DomainModel,
        snapshot: GraphSnapshot,
        data: JsonObject,
    ) -> QueryResult:
        record = ToolCallRecord(
            tool_name=name,
            workspace_id=snapshot.workspace_id,
            parameters=_sanitized_parameters(params.model_dump(mode="json")),
            graph_revision_id=snapshot.revision_id,
            learner_id=_learner_id(params),
            result_count=_result_count(data),
            result_bytes=_json_bytes(data),
            truncated=False,
            latency_ms=_elapsed_ms(getattr(self._timing, "started_at", perf_counter())),
            status="SUCCEEDED",
        )
        if not self._suppress_audit.get():
            self._audit.record(record)
        return QueryResult(
            workspace_id=snapshot.workspace_id,
            graph_revision_id=snapshot.revision_id,
            data=data,
        )


def _learner_id(params: DomainModel) -> UUID | None:
    value = getattr(params, "learner_id", None)
    return value if isinstance(value, UUID) else None


def _authorize_query_context(params: DomainModel, context: object | None) -> None:
    """Apply a second tenant check for callers bypassing ModelGateway."""

    if context is None:
        return
    context_workspace = getattr(context, "workspace_id", None)
    parameter_workspace = getattr(params, "workspace_id", None)
    if context_workspace is not None and parameter_workspace != context_workspace:
        raise ValueError("tool workspace does not match request context")
    context_learner = getattr(context, "learner_id", None)
    parameter_learner = getattr(params, "learner_id", None)
    if parameter_learner is not None and context_learner != parameter_learner:
        raise ValueError("tool learner does not match request context")


def _sanitized_parameters(parameters: JsonObject) -> JsonObject:
    """Bound query text and redact credential-shaped keys before audit storage."""

    sensitive = ("api_key", "password", "secret", "token", "authorization", "cookie")

    def clean(key: str, value: object) -> object:
        lowered = key.casefold()
        if any(marker in lowered for marker in sensitive):
            return "[REDACTED]"
        if isinstance(value, str):
            return value[:500]
        if isinstance(value, dict):
            return {
                str(child_key): clean(str(child_key), child_value)
                for child_key, child_value in list(value.items())[:50]
            }
        if isinstance(value, list):
            return [clean(key, child) for child in value[:50]]
        return value

    return cast(JsonObject, {str(key): clean(str(key), value) for key, value in parameters.items()})


def _tool_result(result: QueryResult, call: ToolCall) -> ToolResult:
    """Convert a query result to the model-facing envelope without raw SQL."""

    return ToolResult(
        tool_call_id=call.id,
        name=call.name,
        content={
            "workspace_id": str(result.workspace_id),
            "graph_revision_id": (
                str(result.graph_revision_id) if result.graph_revision_id is not None else None
            ),
            "tool_name": call.name,
            "result_count": _result_count(result.data),
            "truncated": False,
            "data": result.data,
        },
    )


def _optional_uuid(value: object) -> UUID | None:
    if value in (None, ""):
        return None
    return UUID(str(value))


def _elapsed_ms(started_at: float) -> int:
    return max(0, int((perf_counter() - started_at) * 1_000))


def _result_count(data: JsonObject) -> int:
    if isinstance(data.get("ontology"), dict) and "knowledge_point_count" in data:
        return 1
    for key in (
        "items",
        "nodes",
        "states",
        "theories",
        "sources",
        "knowledge_point_ids",
        "assertions",
    ):
        value = data.get(key)
        if isinstance(value, list):
            return len(value)
    if isinstance(data.get("node"), dict) or isinstance(data.get("assertion"), dict):
        return 1
    return int(bool(data))


def _json_bytes(data: JsonObject) -> int:
    return len(json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode())


def _property_text(node: GraphNode, key: str) -> str:
    value = node.properties.get(key)
    return value if isinstance(value, str) else ""


def _integer_property(node: GraphNode, key: str) -> int:
    value = node.properties.get(key)
    return int(value) if isinstance(value, str | int | float) else 0


def _property_list_text(node: GraphNode, key: str) -> str:
    value = node.properties.get(key)
    if not isinstance(value, list):
        return ""
    return " ".join(item for item in value if isinstance(item, str))


def _node_name(node: GraphNode) -> str:
    return (
        _property_text(node, "display_name")
        or _property_text(node, "canonical_name")
        or _property_text(node, "name")
        or str(node.id)
    )


def _require_node(snapshot: GraphSnapshot, node_id: UUID) -> GraphNode:
    node = next((item for item in snapshot.nodes if item.id == node_id), None)
    if node is None:
        raise KeyError(f"node {node_id} was not found")
    return node


def _require_assertion(snapshot: GraphSnapshot, assertion_id: UUID) -> RelationAssertion:
    assertion = next((item for item in snapshot.assertions if item.id == assertion_id), None)
    if assertion is None:
        raise KeyError(f"assertion {assertion_id} was not found")
    return assertion


def _adjacent_assertions(snapshot: GraphSnapshot, node_id: UUID) -> list[RelationAssertion]:
    return sorted(
        (
            item
            for item in snapshot.assertions
            if item.is_active and node_id in {item.subject_id, item.object_id}
        ),
        key=lambda item: str(item.id),
    )


def _bounded_walk(
    snapshot: GraphSnapshot,
    start_id: UUID,
    predicates: set[RelationTypeKey] | None,
    max_depth: int,
    max_nodes: int,
    direction: str,
) -> tuple[set[UUID], list[RelationAssertion]]:
    visited = {start_id}
    queue: deque[tuple[UUID, int]] = deque([(start_id, 0)])
    selected_assertions: dict[UUID, RelationAssertion] = {}
    while queue and len(visited) < max_nodes:
        current_id, depth = queue.popleft()
        if depth >= max_depth:
            continue
        for assertion in _adjacent_assertions(snapshot, current_id):
            if predicates is not None and assertion.predicate_key not in predicates:
                continue
            if direction == "outgoing" and assertion.subject_id != current_id:
                continue
            if direction == "incoming" and assertion.object_id != current_id:
                continue
            other = (
                assertion.object_id if assertion.subject_id == current_id else assertion.subject_id
            )
            if other not in visited and len(visited) >= max_nodes:
                continue
            selected_assertions[assertion.id] = assertion
            if other not in visited:
                visited.add(other)
                queue.append((other, depth + 1))
    return visited, sorted(selected_assertions.values(), key=lambda item: str(item.id))


def _assertion_summaries(assertions: list[RelationAssertion]) -> list[JsonValue]:
    return [
        {
            "id": str(item.id),
            "subject_id": str(item.subject_id),
            "predicate": item.predicate_key.value,
            "object_id": str(item.object_id),
            "description": item.natural_language_description,
            "active": item.is_active,
        }
        for item in sorted(assertions, key=lambda item: str(item.id))
    ]


def _source_data(snapshot: GraphSnapshot, source_ids: list[UUID]) -> list[JsonValue]:
    selected = [span for span in snapshot.source_spans if span.id in set(source_ids)]
    selected.sort(key=lambda span: (str(span.document_id), span.page_number or 0, str(span.id)))
    documents = {
        node.id: node for node in snapshot.nodes if node.node_type is NodeType.SOURCE_DOCUMENT
    }
    result: list[JsonValue] = []
    for span in selected:
        payload = span.model_dump(mode="json")
        document = documents.get(span.document_id)
        payload["source_document"] = (
            document.model_dump(mode="json") if document is not None else None
        )
        result.append(payload)
    return result


def _conflicts(snapshot: GraphSnapshot, assertion: RelationAssertion) -> list[JsonValue]:
    conflicts = [
        item
        for item in snapshot.assertions
        if item.id != assertion.id
        and item.is_active
        and item.subject_id == assertion.subject_id
        and item.predicate_key is assertion.predicate_key
        and item.object_id != assertion.object_id
    ]
    return _assertion_summaries(conflicts)


def _superseded_data(snapshot: GraphSnapshot, assertion: RelationAssertion) -> JsonValue:
    if assertion.supersedes_assertion_id is None:
        return None
    old = next(
        (item for item in snapshot.assertions if item.id == assertion.supersedes_assertion_id), None
    )
    return old.model_dump(mode="json") if old else None


def _subgraph_data(
    snapshot: GraphSnapshot,
    node_ids: set[UUID],
    assertions: list[RelationAssertion],
) -> JsonObject:
    nodes = sorted(
        (node for node in snapshot.nodes if node.id in node_ids), key=lambda node: str(node.id)
    )
    return {
        "nodes": [node.model_dump(mode="json") for node in nodes],
        "assertions": [item.model_dump(mode="json") for item in assertions],
    }


def _topological_prerequisites(
    snapshot: GraphSnapshot,
    node_ids: set[UUID],
    assertions: list[RelationAssertion],
) -> list[UUID]:
    dependencies: dict[UUID, set[UUID]] = {node_id: set() for node_id in node_ids}
    for assertion in assertions:
        dependencies[assertion.subject_id].add(assertion.object_id)
    ordered: list[UUID] = []
    temporary: set[UUID] = set()
    permanent: set[UUID] = set()

    def visit(node_id: UUID) -> None:
        if node_id in permanent:
            return
        if node_id in temporary:
            raise ValueError("prerequisite graph contains a cycle")
        temporary.add(node_id)
        for dependency in sorted(dependencies[node_id], key=str):
            visit(dependency)
        temporary.remove(node_id)
        permanent.add(node_id)
        ordered.append(node_id)

    for candidate in sorted(node_ids, key=str):
        visit(candidate)
    return ordered
