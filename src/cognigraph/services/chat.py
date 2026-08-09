from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
import weakref
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import cast
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select

from cognigraph.api.schemas import (
    AssessmentResponse,
    ChatRequest,
    ChatResponse,
    GraphUpdateResponse,
    LearnerGraphUpdateResponse,
    LearnerUpdateResponse,
    TargetKnowledgePointResponse,
    ToolUsageResponse,
)
from cognigraph.domain.base import JsonObject
from cognigraph.domain.documents import IngestionReport
from cognigraph.domain.enums import (
    CognitiveLevel,
    EvidenceType,
    HintLevel,
    LearnerRelationType,
    MasteryDecision,
    NodeType,
)
from cognigraph.domain.graph import RelationAssertion
from cognigraph.domain.learner import LearnerKnowledgeState, MasteryEvidence, MasteryUpdate
from cognigraph.domain.teaching import (
    ContextAssertion,
    ContextBundle,
    ContextNode,
    LearnerMasterySummary,
    RecentTurn,
    SessionGoal,
    SourceEvidence,
    TeachingDirective,
    TeachingPolicy,
)
from cognigraph.graph.applier import GraphNode, GraphSnapshot
from cognigraph.graph.context_compiler import (
    ContextCandidates,
    ContextCompilationRequest,
    GraphContextCompiler,
)
from cognigraph.graph.query_tools import (
    FocusSubgraphParams,
    SearchKnowledgePointsParams,
    graph_tool_definitions,
)
from cognigraph.learner.rule_estimator import EvidenceRuleEstimator
from cognigraph.llm.gateway import ModelGatewayError
from cognigraph.llm.schemas import (
    ChatMessage,
    ModelCallContext,
    ModelRole,
    TeacherAssessment,
    TeacherOutput,
    TeacherSeed,
)
from cognigraph.persistence.postgres.models import ConversationTurn
from cognigraph.persistence.postgres.models import (
    LearnerKnowledgeState as LearnerStateRecord,
)
from cognigraph.persistence.postgres.models import (
    MasteryEvidence as EvidenceRecord,
)
from cognigraph.services.learner_graph import LearnerGraphService
from cognigraph.services.runtime import ApplicationRuntime
from cognigraph.tutoring.controller import TeachingController
from cognigraph.tutoring.response_evaluator import ResponseEvaluator
from cognigraph.tutoring.workflow import TutoringWorkflow, WorkflowState

_LEARNING_REQUEST_PATTERN = re.compile(
    r"^\s*(?:(?:please|could you|can you)\s+)?"
    r"(?:teach\s+me|help\s+me\s+learn|explain|what\s+is|review|study|learn\s+about)\b"
    r"|^\s*(?:请)?(?:教我|讲解|解释|介绍|复习|学习|什么是|我想学|想了解)",
    re.IGNORECASE,
)
_PURE_SELF_REPORT_PATTERN = re.compile(
    r"^\s*(?:"
    r"i\s+(?:understand|see|get\s+it)(?:\s+(?:it|this|now))?"
    r"|got\s+it|makes\s+sense|懂了|明白了|我懂了|我明白了|会了|知道了"
    r")[.!。\uff01?\uff1f]*\s*$",
    re.IGNORECASE,
)
_SEARCH_TOKEN_PATTERN = re.compile(r"[\w\u3400-\u9fff]+", re.UNICODE)
_CJK_ASCII_BOUNDARY_PATTERN = re.compile(
    r"(?<=[\u3400-\u9fff])(?=[a-z0-9])|(?<=[a-z0-9])(?=[\u3400-\u9fff])",
    re.IGNORECASE,
)
logger = logging.getLogger(__name__)
_SEARCH_STOP_WORDS = frozenset(
    {
        "about",
        "explain",
        "help",
        "learn",
        "me",
        "please",
        "review",
        "study",
        "teach",
        "the",
        "what",
        "什么是",
        "介绍",
        "学习",
        "教我",
        "解释",
        "讲解",
    }
)
_CJK_LEARNING_PREFIXES = (
    "我想学习",
    "我想了解",
    "什么是",
    "请解释",
    "请介绍",
    "请讲解",
    "我想学",
    "想了解",
    "教我",
    "讲解",
    "解释",
    "介绍",
    "复习",
    "学习",
    "请",
)
_EVIDENCE_FORMS: dict[CognitiveLevel, tuple[EvidenceType, EvidenceType]] = {
    CognitiveLevel.INTUITIVE_RECOGNITION: (
        EvidenceType.RECOGNITION,
        EvidenceType.EXPLANATION,
    ),
    CognitiveLevel.GUIDED_IMITATION: (
        EvidenceType.WORKED_EXAMPLE,
        EvidenceType.APPLICATION,
    ),
    CognitiveLevel.CONCEPTUAL_UNDERSTANDING: (
        EvidenceType.EXPLANATION,
        EvidenceType.CRITIQUE,
    ),
    CognitiveLevel.INDEPENDENT_APPLICATION: (
        EvidenceType.APPLICATION,
        EvidenceType.TRANSFER,
    ),
    CognitiveLevel.CRITICAL_TRANSFER: (
        EvidenceType.TRANSFER,
        EvidenceType.CRITIQUE,
    ),
    CognitiveLevel.CREATION_RESEARCH: (
        EvidenceType.CREATION,
        EvidenceType.CRITIQUE,
    ),
}


@dataclass(slots=True)
class _SessionLockEntry:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    references: int = 0


class _SessionLockRegistry:
    """Reference-counted workflow locks scoped to one application runtime."""

    def __init__(self) -> None:
        self._entries: dict[UUID, _SessionLockEntry] = {}
        self._guard = asyncio.Lock()

    @property
    def active_session_count(self) -> int:
        return len(self._entries)

    @asynccontextmanager
    async def hold(self, session_id: UUID) -> AsyncIterator[None]:
        async with self._guard:
            entry = self._entries.get(session_id)
            if entry is None:
                entry = _SessionLockEntry()
                self._entries[session_id] = entry
            entry.references += 1

        acquired = False
        try:
            await entry.lock.acquire()
            acquired = True
            yield
        finally:
            if acquired:
                entry.lock.release()
            await asyncio.shield(self._release_reference(session_id, entry))

    async def _release_reference(self, session_id: UUID, entry: _SessionLockEntry) -> None:
        async with self._guard:
            entry.references -= 1
            if entry.references < 0:
                raise RuntimeError("session workflow lock reference count became negative")
            if entry.references == 0:
                current = self._entries.get(session_id)
                if current is entry:
                    self._entries.pop(session_id, None)


_RUNTIME_SESSION_LOCKS: weakref.WeakKeyDictionary[ApplicationRuntime, _SessionLockRegistry] = (
    weakref.WeakKeyDictionary()
)
_RUNTIME_SESSION_LOCKS_GUARD = threading.Lock()


def _session_locks_for(runtime: ApplicationRuntime) -> _SessionLockRegistry:
    # ChatService is intentionally short-lived in the API dependency graph. Keeping the
    # registry on the shared runtime makes serialization survive service reconstruction,
    # while weak keys prevent retired runtimes from leaking lock registries.
    with _RUNTIME_SESSION_LOCKS_GUARD:
        registry = _RUNTIME_SESSION_LOCKS.get(runtime)
        if registry is None:
            registry = _SessionLockRegistry()
            _RUNTIME_SESSION_LOCKS[runtime] = registry
        return registry


@dataclass(slots=True)
class ChatTurnContext:
    request: ChatRequest
    user_turn: ConversationTurn | None = None
    prior_assistant: ConversationTurn | None = None
    recent_turns: list[ConversationTurn] = field(default_factory=list)
    target_node: GraphNode | None = None
    session_goal_knowledge_point_id: UUID | None = None
    is_assessment_response: bool = False
    previous_hint_level: HintLevel | None = None
    learner_state_record: LearnerStateRecord | None = None
    # The revision that was current when this turn began. Model-run audits
    # point to this immutable input state; the newly created revision is
    # returned after persistence below.
    learner_graph_revision_id: UUID | None = None
    learner_state: LearnerKnowledgeState | None = None
    evidence_history: list[MasteryEvidence] = field(default_factory=list)
    evidence: MasteryEvidence | None = None
    mastery_update: MasteryUpdate | None = None
    directive: TeachingDirective | None = None
    bundle: ContextBundle | None = None
    teacher_output: TeacherOutput | None = None
    assistant_turn: ConversationTurn | None = None
    graph_report: IngestionReport | None = None
    graph_update: GraphUpdateResponse | None = None
    learner_graph_update: LearnerGraphUpdateResponse | None = None
    tool_usage: ToolUsageResponse | None = None
    model_fallback: bool = False
    semantic_projection_fallback: bool = False
    sources: list[dict[str, object]] = field(default_factory=list)
    response: ChatResponse | None = None


class ChatService:
    def __init__(self, runtime: ApplicationRuntime) -> None:
        self.runtime = runtime
        self.controller = TeachingController()
        self.compiler = GraphContextCompiler()
        # Runtime ownership makes the revision-keyed manifest cache effective
        # across the short-lived ChatService instances created by API requests.
        self.manifest_service = runtime.manifest_service
        self.evaluator = ResponseEvaluator(runtime.model_gateway)
        self.learner_graph_service = LearnerGraphService()
        self._session_locks = _session_locks_for(runtime)
        self.workflow = TutoringWorkflow(
            {
                "understand_and_retrieve": self._node_understand,
                "evaluate_response": self._node_evaluate,
                "choose_teaching_action": self._node_choose_action,
                "compile_context": self._node_compile_context,
                "generate_teaching_turn": self._node_generate,
                "persist_turn": self._node_persist,
            }
        )

    async def chat(self, request: ChatRequest) -> ChatResponse:
        async with self._session_locks.hold(request.session_id):
            cached_response, existing_user_turn = await self._idempotent_request_state(request)
            if cached_response is not None:
                return cached_response
            context = ChatTurnContext(request=request, user_turn=existing_user_turn)
            state: WorkflowState = {"context": context}
            result = await self.workflow.run(state, checkpoint_id=str(request.session_id))
            final_context = cast(ChatTurnContext, result["context"])
            if final_context.response is None:
                raise RuntimeError("teaching workflow completed without a response")
            return final_context.response

    async def _idempotent_request_state(
        self,
        request: ChatRequest,
    ) -> tuple[ChatResponse | None, ConversationTurn | None]:
        if request.client_request_id is None:
            return None, None
        async with self.runtime.database.unit_of_work() as unit:
            session = await unit.sessions.get(request.session_id)
            if session is None:
                return None, None
            if (
                session.workspace_id != request.workspace_id
                or session.learner_id != request.learner_id
            ):
                raise ValueError("session does not belong to the requested workspace and learner")
            turns = await unit.turns.recent(request.session_id, limit=100)
        request_id = str(request.client_request_id)
        matching = [
            turn for turn in turns if turn.metadata_json.get("client_request_id") == request_id
        ]
        if not matching:
            return None, None
        expected = self._client_request_metadata(request)
        user_turn = next((turn for turn in matching if turn.role == "user"), None)
        if user_turn is None:
            raise RuntimeError("idempotent chat request is missing its user turn")
        if user_turn.content != request.message or any(
            user_turn.metadata_json.get(key) != value for key, value in expected.items()
        ):
            raise ValueError("client_request_id cannot be reused with a different chat request")
        assistant_turn = next(
            (turn for turn in reversed(matching) if turn.role == "assistant"),
            None,
        )
        if assistant_turn is None:
            return None, user_turn
        cached = assistant_turn.metadata_json.get("chat_response")
        if not isinstance(cached, Mapping):
            raise ValueError(
                "this teaching request already completed; start a new turn to continue"
            )
        try:
            return ChatResponse.model_validate(cached), user_turn
        except ValueError as exc:
            raise RuntimeError("stored idempotent chat response is invalid") from exc

    @staticmethod
    def _client_request_metadata(request: ChatRequest) -> dict[str, object]:
        if request.client_request_id is None:
            return {}
        return {
            "client_request_id": str(request.client_request_id),
            "attachment_ids": [str(item) for item in request.attachment_ids],
            "requested_mode": request.requested_mode.value,
        }

    async def _node_understand(self, state: WorkflowState) -> WorkflowState:
        context = self._context(state)
        request = context.request
        await self.runtime.ensure_graph_loaded(request.workspace_id)
        async with self.runtime.database.unit_of_work() as unit:
            workspace = await unit.workspaces.get(request.workspace_id)
            learner = await unit.learners.get(request.learner_id, workspace_id=request.workspace_id)
            if workspace is None or learner is None:
                raise LookupError("workspace or learner does not exist")
            session = await unit.sessions.get(request.session_id)
            if session is None:
                session = await unit.sessions.get_or_create(
                    workspace_id=request.workspace_id,
                    learner_id=request.learner_id,
                    requested_mode=request.requested_mode.value,
                    session_id=request.session_id,
                )
            elif (
                session.workspace_id != request.workspace_id
                or session.learner_id != request.learner_id
            ):
                raise ValueError("session does not belong to the requested workspace and learner")
            context.recent_turns = await unit.turns.recent(
                session.id,
                limit=self.runtime.settings.max_recent_turns,
            )
            context.prior_assistant = next(
                (turn for turn in reversed(context.recent_turns) if turn.role == "assistant"),
                None,
            )
            context.previous_hint_level = self._prior_hint_level(context.prior_assistant)
            if context.user_turn is None:
                context.user_turn = await unit.turns.add(
                    workspace_id=request.workspace_id,
                    learner_id=request.learner_id,
                    session_id=session.id,
                    role="user",
                    content=request.message,
                    metadata_json=self._client_request_metadata(request),
                )
            await unit.commit()

        for attachment_id in request.attachment_ids:
            document = await self.runtime.document_registry.get(attachment_id)
            if document.workspace_id != request.workspace_id:
                raise ValueError("attachment does not belong to the workspace")
            if attachment_id not in self.runtime.document_registry.reports:
                await self.runtime.ingestion.ingest(attachment_id)

        snapshot = await self.runtime.ensure_graph_loaded(request.workspace_id)
        prior_target_id = self._prior_target(context)
        new_learning_request = context.prior_assistant is None or self._looks_like_learning_request(
            request.message
        )
        context.is_assessment_response = bool(
            context.prior_assistant is not None
            and context.prior_assistant.assessment
            and not new_learning_request
        )
        if new_learning_request:
            existing_knowledge_ids = {
                node.id for node in snapshot.nodes if node.node_type is NodeType.KNOWLEDGE_POINT
            }
            target = await self._find_semantic_target(snapshot, request.message)
            if target is None:
                upload = await self.runtime.ingestion.upload(
                    workspace_id=request.workspace_id,
                    filename="chat-input.txt",
                    mime_type="text/plain",
                    content=request.message.encode("utf-8"),
                )
                context.graph_report = await self.runtime.ingestion.ingest(
                    upload.document_id,
                    compact_chat_topic=True,
                )
                snapshot = await self.runtime.ensure_graph_loaded(request.workspace_id)
                target = await self._find_semantic_target(snapshot, request.message)
                if target is None:
                    current_source_span_ids = {
                        span.id
                        for span in snapshot.source_spans
                        if span.document_id == upload.document_id
                    }
                    ingested_candidates = [
                        node
                        for node in snapshot.nodes
                        if node.node_type is NodeType.KNOWLEDGE_POINT
                        and (
                            node.id not in existing_knowledge_ids
                            or bool(current_source_span_ids.intersection(node.source_span_ids))
                        )
                    ]
                    target = self._select_target(
                        ingested_candidates,
                        request.message,
                        allow_unmatched=True,
                    )
            context.target_node = target
            context.session_goal_knowledge_point_id = target.id if target is not None else None
            context.previous_hint_level = None
        else:
            context.target_node = (
                snapshot.node_map().get(prior_target_id) if prior_target_id is not None else None
            )
            context.session_goal_knowledge_point_id = self._prior_session_goal(context)
        if context.target_node is None:
            if new_learning_request:
                raise ValueError(
                    "No teachable knowledge point could be identified. "
                    "Ask about one specific topic or attach source material, then retry."
                )
            raise LookupError("the session teaching target no longer exists")
        await self._load_learner_context(context, context.target_node.id)
        return state

    async def _node_evaluate(self, state: WorkflowState) -> WorkflowState:
        context = self._context(state)
        if (
            not context.is_assessment_response
            or context.prior_assistant is None
            or context.user_turn is None
        ):
            return state
        assessment = context.prior_assistant.assessment
        if not assessment or context.learner_state is None or context.target_node is None:
            return state
        evaluated_state = context.learner_state
        assessed_level = CognitiveLevel(
            context.prior_assistant.cognitive_level or int(evaluated_state.current_level)
        )
        evidence_type = (
            EvidenceType.SELF_REPORT
            if self._is_pure_self_report(context.request.message)
            else self._next_evidence_type(context, assessed_level)
        )
        snapshot = self.runtime.graph_applier.store.get_snapshot(context.request.workspace_id)
        stage = self._teaching_stage(snapshot, context.target_node.id, assessed_level)
        source_context = self._source_context(snapshot, context.target_node)
        evidence = await self.evaluator.evaluate(
            workspace_id=context.request.workspace_id,
            learner_id=context.request.learner_id,
            knowledge_point_id=context.target_node.id,
            session_id=context.request.session_id,
            turn_id=context.user_turn.id,
            cognitive_level=assessed_level,
            question=str(assessment.get("question", "")),
            rubric=[str(item) for item in assessment.get("success_criteria", [])],
            raw_answer=context.request.message,
            evidence_type=evidence_type,
            source_supported_definition=self._node_definition(context.target_node),
            must_cover=self._stage_list(stage, "must_cover", "must_cover_items")
            or self._node_string_list(context.target_node, "must_cover"),
            learning_objective=str(stage.get("learning_objective", "")),
            teaching_strategy=str(stage.get("teaching_strategy", "")),
            hint_level=context.previous_hint_level or HintLevel.LEVEL_1_DIRECTION,
            supporting_sources=source_context,
            graph_revision_id=snapshot.revision_id,
            learner_graph_revision_id=context.learner_graph_revision_id,
        )
        context.evidence = evidence
        update = await EvidenceRuleEstimator(context.evidence_history).update(
            evaluated_state, evidence
        )
        if evidence_type is EvidenceType.SELF_REPORT:
            update = update.model_copy(
                update={
                    "decision": MasteryDecision.REQUEST_MORE_EVIDENCE,
                    "reason": "Self-report alone cannot establish mastery.",
                    "promotion_eligible": False,
                    "updated_state": update.updated_state.model_copy(
                        update={"current_level": evaluated_state.current_level}
                    ),
                    "machine_reason": {
                        **update.machine_reason,
                        "self_report_only": True,
                    },
                }
            )
        context.mastery_update = update
        context.learner_state = update.updated_state
        return state

    async def _node_choose_action(self, state: WorkflowState) -> WorkflowState:
        context = self._context(state)
        if context.learner_state is None or context.target_node is None:
            raise RuntimeError("learner state and target are required before action selection")
        snapshot = self.runtime.graph_applier.store.get_snapshot(context.request.workspace_id)
        prerequisites, prerequisite_priorities = await self._ordered_prerequisite_status(
            learner_id=context.request.learner_id,
            workspace_id=context.request.workspace_id,
            target_id=context.target_node.id,
            assertions=snapshot.assertions,
            max_depth=min(self.runtime.settings.max_graph_depth, 3),
        )
        goal = SessionGoal(
            knowledge_point_id=context.target_node.id,
            requested_mode=context.request.requested_mode,
            description=(
                f"Learn {self._node_name(context.target_node)} while preserving the session goal"
            ),
        )
        directive = self.controller.decide(
            learner_state=context.learner_state,
            current_knowledge_point_id=context.target_node.id,
            latest_update=context.mastery_update,
            prerequisite_status=prerequisites,
            prerequisite_priorities=prerequisite_priorities,
            session_goal=goal,
            previous_hint_level=(
                context.previous_hint_level if context.is_assessment_response else None
            ),
        )
        if directive.target_knowledge_point_id != context.target_node.id:
            teaching_target = snapshot.node_map().get(directive.target_knowledge_point_id)
            if teaching_target is None or teaching_target.node_type is not NodeType.KNOWLEDGE_POINT:
                raise LookupError("the selected prerequisite is not a teachable knowledge point")
            context.target_node = teaching_target
            await self._load_learner_context(context, teaching_target.id)
            if context.learner_state is None:
                raise RuntimeError("prerequisite learner state could not be loaded")
            directive = directive.model_copy(
                update={"target_level": context.learner_state.current_level}
            )
        context.directive = directive
        return state

    async def _node_compile_context(self, state: WorkflowState) -> WorkflowState:
        context = self._context(state)
        if (
            context.target_node is None
            or context.learner_state is None
            or context.directive is None
        ):
            raise RuntimeError("action context is incomplete")
        snapshot = self.runtime.graph_applier.store.get_snapshot(context.request.workspace_id)
        manifest = self.manifest_service.build(snapshot)
        target_id = context.target_node.id
        semantic_focus = await self.runtime.semantic_queries.get_focus_subgraph(
            FocusSubgraphParams(
                workspace_id=context.request.workspace_id,
                node_id=target_id,
                max_depth=min(self.runtime.settings.max_graph_depth, 3),
                max_nodes=min(self.runtime.settings.max_graph_nodes, 100),
            )
        )
        if semantic_focus.graph_revision_id != snapshot.revision_id:
            await self.runtime.outbox_dispatcher.dispatch_once(
                batch_size=self.runtime.settings.outbox_batch_size
            )
            semantic_focus = await self.runtime.semantic_queries.get_focus_subgraph(
                FocusSubgraphParams(
                    workspace_id=context.request.workspace_id,
                    node_id=target_id,
                    max_depth=min(self.runtime.settings.max_graph_depth, 3),
                    max_nodes=min(self.runtime.settings.max_graph_nodes, 100),
                )
            )
        if semantic_focus.graph_revision_id != snapshot.revision_id:
            logger.warning(
                "semantic graph projection behind; using SQL-rehydrated bounded graph reads",
                extra={
                    "semantic_projection_fallback": True,
                    "workspace_id": str(context.request.workspace_id),
                    "expected_graph_revision_id": str(snapshot.revision_id),
                    "observed_graph_revision_id": (
                        str(semantic_focus.graph_revision_id)
                        if semantic_focus.graph_revision_id is not None
                        else None
                    ),
                },
            )
            semantic_focus = self.runtime.graph_queries.get_focus_subgraph(
                FocusSubgraphParams(
                    workspace_id=context.request.workspace_id,
                    node_id=target_id,
                    max_depth=min(self.runtime.settings.max_graph_depth, 3),
                    max_nodes=min(self.runtime.settings.max_graph_nodes, 100),
                )
            )
            context.semantic_projection_fallback = True

        semantic_node_ids = _uuid_ids_from_records(semantic_focus.data.get("nodes"))
        semantic_assertion_ids = _uuid_ids_from_records(semantic_focus.data.get("assertions"))
        if target_id not in semantic_node_ids:
            raise RuntimeError("target knowledge point is missing from the semantic graph")
        focus_assertions = [
            item
            for item in snapshot.assertions
            if item.is_active and item.id in semantic_assertion_ids
        ]
        related_assertions = [
            item
            for item in focus_assertions
            if item.subject_id == target_id or item.object_id == target_id
        ]
        related_ids = {
            item.object_id if item.subject_id == target_id else item.subject_id
            for item in related_assertions
        }
        nodes = snapshot.node_map()
        related_ids = {
            node_id
            for node_id in related_ids
            if node_id in nodes and nodes[node_id].node_type is not NodeType.LEARNING_STAGE
        }
        prerequisite_ids = _ordered_prerequisite_ids(
            target_id,
            focus_assertions,
            max_depth=min(self.runtime.settings.max_graph_depth, 3),
        )
        prerequisites = [
            nodes[node_id]
            for node_id in prerequisite_ids
            if node_id in nodes and nodes[node_id].node_type is NodeType.KNOWLEDGE_POINT
        ]
        prerequisite_id_set = set(prerequisite_ids)
        related_ids.difference_update(prerequisite_id_set)
        examples = [
            nodes[item.subject_id]
            for item in related_assertions
            if item.object_id == target_id
            and item.predicate_key.value in {"EXAMPLE_OF", "COUNTEREXAMPLE_OF"}
            and item.subject_id in nodes
        ]
        source_spans = {item.id: item for item in snapshot.source_spans}
        sources = [
            SourceEvidence(
                source_span_id=source_id,
                document_id=source_spans[source_id].document_id,
                page_number=source_spans[source_id].page_number,
                heading_path=source_spans[source_id].heading_path,
                excerpt=source_spans[source_id].text,
                confidence=1.0,
            )
            for source_id in context.target_node.source_span_ids
            if source_id in source_spans
        ]
        context.sources = [source.model_dump(mode="json") for source in sources]
        current_stage = self._teaching_stage(
            snapshot,
            target_id,
            context.directive.target_level,
        )
        focus_nodes = [
            _context_node(context.target_node, relevance=1.0),
            *[_context_node(item, relevance=0.8) for item in prerequisites],
            *[_context_node(nodes[item], relevance=0.5) for item in related_ids if item in nodes],
        ]
        mastery = [
            LearnerMasterySummary(
                knowledge_point_id=context.learner_state.knowledge_point_id,
                current_level=context.learner_state.current_level,
                mastery_score=context.learner_state.mastery_score,
                confidence=context.learner_state.confidence,
                unresolved_misconceptions=context.learner_state.critical_misconceptions,
            )
        ]
        recent = [
            RecentTurn(
                turn_id=turn.id,
                role=turn.role,
                content=turn.content,
                created_at=turn.created_at,
            )
            for turn in context.recent_turns
        ]
        policy = TeachingPolicy(
            allowed_next_actions=[context.directive.teaching_action],
            default_hint_level=context.directive.hint_level,
        )
        candidates = ContextCandidates(
            current_knowledge_point=focus_nodes[0],
            prerequisite_chain=focus_nodes[1 : 1 + len(prerequisites)],
            direct_dependencies=focus_nodes[1 + len(prerequisites) :],
            examples=[_context_node(item, relevance=0.6) for item in examples],
            supporting_sources=sources,
            focus_assertions=[
                ContextAssertion(
                    id=item.id,
                    subject_id=item.subject_id,
                    predicate=item.predicate_key.value,
                    object_id=item.object_id,
                    description=item.natural_language_description,
                    confidence=item.confidence,
                    source_span_ids=item.source_span_ids,
                )
                for item in focus_assertions
            ],
            learner_mastery=mastery,
            relevant_misconceptions=context.learner_state.critical_misconceptions,
            current_teaching_stage=current_stage,
            recent_turns=recent,
        )
        context.bundle = self.compiler.compile(
            ContextCompilationRequest(
                workspace_id=context.request.workspace_id,
                learner_id=context.request.learner_id,
                session_id=context.request.session_id,
                user_message=context.request.message,
                target_knowledge_point_id=target_id,
                token_budget=self.runtime.settings.max_context_tokens,
            ),
            manifest,
            candidates,
            SessionGoal(
                knowledge_point_id=(context.session_goal_knowledge_point_id or target_id),
                requested_mode=context.request.requested_mode,
                description=f"Learn {self._node_name(context.target_node)}",
            ),
            policy,
        )
        return state

    async def _node_generate(self, state: WorkflowState) -> WorkflowState:
        context = self._context(state)
        if context.bundle is None or context.directive is None:
            raise RuntimeError("context bundle is required before generation")
        prompt = self.runtime.prompts.load("teacher_system")
        generation_payload = {
            "context_bundle": context.bundle.model_dump(mode="json"),
            "directive": context.directive.model_dump(mode="json"),
            "untrusted_learner_message": context.request.message,
        }
        try:
            seed, result = await self.runtime.model_gateway.generate_structured(
                role=ModelRole.TEACHER,
                messages=[
                    ChatMessage(role="system", content=prompt.content),
                    ChatMessage(
                        role="user",
                        content=json.dumps(
                            generation_payload,
                            ensure_ascii=False,
                            separators=(",", ":"),
                            sort_keys=True,
                        ),
                    ),
                ],
                response_model=TeacherSeed,
                context=ModelCallContext(
                    workspace_id=context.request.workspace_id,
                    learner_id=context.request.learner_id,
                    session_id=context.request.session_id,
                    turn_id=context.user_turn.id if context.user_turn is not None else None,
                    graph_revision_id=context.bundle.graph_revision,
                    learner_graph_revision_id=context.learner_graph_revision_id,
                    context_truncated=context.bundle.truncated,
                    prompt_name=prompt.name,
                    prompt_version=prompt.version,
                ),
                tools=graph_tool_definitions(),
                tool_executor=(
                    self.runtime.graph_queries
                    if context.semantic_projection_fallback
                    else self.runtime.semantic_queries
                ),
            )
            context.tool_usage = ToolUsageResponse.model_validate(result.tool_usage)
        except ModelGatewayError as exc:
            if not isinstance(exc.cause, (ValidationError, json.JSONDecodeError)):
                raise
            logger.warning(
                "teacher model fallback activated",
                extra={"model_fallback": True, "error_type": type(exc).__name__},
            )
            seed = self._teacher_fallback_seed(context)
            context.model_fallback = True
            context.tool_usage = ToolUsageResponse(
                enabled=False,
                steps=0,
                tools=[],
                fallback=True,
            )
        acknowledgement = (
            "我们先聚焦这个问题。"
            if any("\u3400" <= character <= "\u9fff" for character in context.request.message)
            else "Let's focus on this question."
        )
        teacher = TeacherOutput(
            acknowledgement=acknowledgement,
            core_explanation=seed.core_explanation,
            illustration=seed.illustration,
            key_takeaway=seed.key_takeaway,
            assessment=TeacherAssessment(
                type=context.directive.assessment_type,
                question=seed.assessment_question,
            ),
        )
        context.teacher_output = teacher
        return state

    @staticmethod
    def _teacher_fallback_seed(context: ChatTurnContext) -> TeacherSeed:
        """Keep a failed provider from blocking a turn with unverified content."""

        if context.target_node is None or context.directive is None:
            raise RuntimeError("teacher fallback requires a target and directive")
        properties = context.target_node.properties
        name = ChatService._node_name(context.target_node)
        definition = next(
            (
                str(properties.get(key)).strip()
                for key in (
                    "plain_language_definition",
                    "plain_definition",
                    "summary",
                    "formal_definition",
                )
                if isinstance(properties.get(key), str) and str(properties.get(key)).strip()
            ),
            "",
        )
        core = definition[:12_000] if definition else f"当前学习目标是 {name}。"
        source_excerpt = next(
            (
                str(item.get("excerpt")).strip()
                for item in context.sources
                if isinstance(item.get("excerpt"), str) and str(item.get("excerpt")).strip()
            ),
            "",
        )
        if source_excerpt:
            illustration = f"当前来源摘录 (请核对): {source_excerpt[:2_000]}"
        else:
            illustration = core
        is_cjk = any("\u3400" <= character <= "\u9fff" for character in context.request.message)
        if is_cjk:
            takeaway = "本轮只把能够由当前来源核对的内容作为暂定结论。"
            question = "请用自己的话说明这个学习目标, 并给出一个支持你回答的依据。"
        else:
            takeaway = (
                "Treat this as a provisional explanation until the current sources support it."
            )
            question = (
                "In your own words, explain this learning objective and give one supporting reason."
            )
        return TeacherSeed(
            core_explanation=core,
            illustration=illustration,
            key_takeaway=takeaway,
            assessment_question=question,
        )

    async def _node_persist(self, state: WorkflowState) -> WorkflowState:
        context = self._context(state)
        if (
            context.teacher_output is None
            or context.directive is None
            or context.learner_state is None
            or context.target_node is None
            or context.bundle is None
        ):
            raise RuntimeError("teaching output is incomplete")
        async with self.runtime.database.unit_of_work() as unit:
            teaching_state_record = await unit.learner_states.get_or_create(
                workspace_id=context.request.workspace_id,
                learner_id=context.request.learner_id,
                knowledge_point_id=context.target_node.id,
            )
            if context.mastery_update is not None:
                updated_point_id = context.mastery_update.updated_state.knowledge_point_id
                evaluated_state_record = (
                    teaching_state_record
                    if updated_point_id == context.target_node.id
                    else await unit.learner_states.get_or_create(
                        workspace_id=context.request.workspace_id,
                        learner_id=context.request.learner_id,
                        knowledge_point_id=updated_point_id,
                    )
                )
                _update_record(
                    evaluated_state_record,
                    context.mastery_update.updated_state,
                )
                if context.evidence is not None:
                    db_session = unit.session
                    if db_session is None:
                        raise RuntimeError("unit of work did not initialize its SQL session")
                    db_session.add(_evidence_record(context.evidence, context.request.workspace_id))
            else:
                teaching_state_record.last_interaction_at = context.learner_state.updated_at
            assessment = {
                "type": context.teacher_output.assessment.type.value,
                "question": context.teacher_output.assessment.question,
                "success_criteria": self._criteria(context),
                "target_knowledge_point_id": str(context.target_node.id),
                "target_level": int(context.directive.target_level),
                "hint_level": int(context.directive.hint_level),
            }
            context.assistant_turn = await unit.turns.add(
                workspace_id=context.request.workspace_id,
                learner_id=context.request.learner_id,
                session_id=context.request.session_id,
                role="assistant",
                content=context.teacher_output.render(),
                target_knowledge_point_id=context.target_node.id,
                cognitive_level=int(context.directive.target_level),
                teaching_action=context.directive.teaching_action.value,
                assessment=assessment,
                context_revision_id=context.bundle.graph_revision,
                metadata_json={
                    **self._client_request_metadata(context.request),
                    "hint_level": int(context.directive.hint_level),
                    "assessment_target_knowledge_point_id": str(context.target_node.id),
                    "session_goal_knowledge_point_id": str(
                        context.session_goal_knowledge_point_id or context.target_node.id
                    ),
                },
            )
            tutoring_session = await unit.sessions.get(context.request.session_id)
            if tutoring_session is not None:
                tutoring_session.current_knowledge_point_id = context.target_node.id
            await unit.flush()
            current_state_for_graph = (
                context.mastery_update.updated_state
                if context.mastery_update is not None
                and context.mastery_update.updated_state.knowledge_point_id
                == context.target_node.id
                else context.learner_state
            )
            if current_state_for_graph is None:
                raise RuntimeError("learner state is required for learner graph revision")
            assertion_drafts, replace_keys, change_summary = self._learner_graph_drafts(
                context,
                current_state_for_graph,
            )
            learner_graph_result = await self.learner_graph_service.record_turn(
                unit,
                workspace_id=context.request.workspace_id,
                learner_id=context.request.learner_id,
                session_id=context.request.session_id,
                turn_id=context.assistant_turn.id,
                assertions=assertion_drafts,
                replace_keys=replace_keys,
                change_summary=change_summary,
            )
            context.learner_graph_update = LearnerGraphUpdateResponse(
                revision_id=learner_graph_result.revision_id,
                assertions_added=learner_graph_result.assertions_added,
                assertions_superseded=learner_graph_result.assertions_superseded,
            )
            self._finalize_response(context)
            if context.response is None:
                raise RuntimeError("teaching response was not assembled")
            if context.request.client_request_id is not None:
                context.assistant_turn.metadata_json = {
                    **context.assistant_turn.metadata_json,
                    "chat_response": context.response.model_dump(mode="json"),
                }
            await unit.commit()
        return state

    def _finalize_response(self, context: ChatTurnContext) -> None:
        if (
            context.assistant_turn is None
            or context.teacher_output is None
            or context.target_node is None
            or context.directive is None
            or context.learner_state is None
        ):
            raise RuntimeError("teaching output is incomplete")
        snapshot = self.runtime.graph_applier.store.get_snapshot(context.request.workspace_id)
        revision = (
            context.graph_report.graph_revision_id if context.graph_report else snapshot.revision_id
        )
        counts = context.graph_report
        context.graph_update = GraphUpdateResponse(
            revision_id=revision,
            nodes_added=(counts.knowledge_point_count if counts else 0),
            assertions_added=(counts.assertion_count if counts else 0),
            assertions_superseded=0,
        )
        update = context.mastery_update
        current_state = (
            update.updated_state
            if update is not None
            and update.updated_state.knowledge_point_id == context.target_node.id
            else context.learner_state
        )
        decision = update.decision if update else MasteryDecision.HOLD
        reason = (
            update.reason
            if update
            else "Initial diagnostic turn; no prior mastery assessment was answered."
        )
        context.response = ChatResponse(
            turn_id=context.assistant_turn.id,
            response=context.teacher_output.render(),
            target_knowledge_point=TargetKnowledgePointResponse(
                id=context.target_node.id,
                name=self._node_name(context.target_node),
            ),
            cognitive_level=context.directive.target_level,
            teaching_action=context.directive.teaching_action.value,
            assessment=AssessmentResponse(
                type=context.teacher_output.assessment.type.value,
                question=context.teacher_output.assessment.question,
            ),
            learner_update=LearnerUpdateResponse(
                decision=decision.value,
                reason=reason,
                current_level=current_state.current_level,
                mastery_score=current_state.mastery_score,
                confidence=current_state.confidence,
            ),
            graph_update=context.graph_update,
            learner_graph_update=context.learner_graph_update,
            tool_usage=context.tool_usage,
            model_fallback=context.model_fallback,
            sources=context.sources,
        )

    @staticmethod
    def _learner_graph_drafts(
        context: ChatTurnContext,
        current_state: LearnerKnowledgeState,
    ) -> tuple[
        list[dict[str, object]],
        list[tuple[str, UUID, UUID]],
        dict[str, object],
    ]:
        """Build constrained learner-graph edges from deterministic state.

        The teacher model never supplies these edges.  They are derived from
        the persisted state/evidence and therefore cannot contaminate the
        authoritative domain graph.
        """

        if context.user_turn is None or context.assistant_turn is None:
            raise RuntimeError("learner graph assertions require persisted turn ids")
        learner_id = context.request.learner_id
        target_id = (
            context.target_node.id
            if context.target_node is not None
            else current_state.knowledge_point_id
        )
        goal_target_id = context.session_goal_knowledge_point_id or target_id
        turn_id = context.user_turn.id
        confidence = max(0.0, min(1.0, current_state.confidence))
        drafts: list[dict[str, object]] = [
            {
                "subject_id": learner_id,
                "predicate": LearnerRelationType.HAS_KNOWLEDGE_STATE.value,
                "object_id": current_state.knowledge_point_id,
                "natural_language_description": (
                    f"Learner state for {current_state.knowledge_point_id}: level "
                    f"{int(current_state.current_level)}, "
                    f"mastery {current_state.mastery_score:.3f}."
                ),
                "confidence": confidence,
                "source_turn_id": turn_id,
            },
            {
                "subject_id": learner_id,
                "predicate": LearnerRelationType.LEARNING_GOAL.value,
                "object_id": goal_target_id,
                "natural_language_description": "The learner's current tutoring goal.",
                "confidence": 1.0,
                "source_turn_id": turn_id,
            },
            {
                "subject_id": learner_id,
                "predicate": LearnerRelationType.RECENTLY_PRACTICED.value,
                "object_id": target_id,
                "natural_language_description": (
                    "The learner practiced this knowledge point in the latest turn."
                ),
                "confidence": 1.0,
                "source_turn_id": turn_id,
            },
        ]
        replace_keys = [
            (
                LearnerRelationType.HAS_KNOWLEDGE_STATE.value,
                learner_id,
                current_state.knowledge_point_id,
            ),
            (LearnerRelationType.LEARNING_GOAL.value, learner_id, goal_target_id),
            (LearnerRelationType.RECENTLY_PRACTICED.value, learner_id, target_id),
            (LearnerRelationType.READY_FOR_PROMOTION.value, learner_id, target_id),
            (LearnerRelationType.REQUIRES_REVIEW.value, learner_id, target_id),
            (LearnerRelationType.NEEDS_TRANSFER_EVIDENCE.value, learner_id, target_id),
            (LearnerRelationType.HAS_MISCONCEPTION.value, learner_id, target_id),
        ]
        if context.graph_report is not None:
            # ``graph_report`` is set here only when a new topic had to be
            # extracted from the learner's raw chat message. Keep an explicit
            # learner-side candidate marker; the corresponding domain nodes
            # remain UNVERIFIED and are never promoted by this relationship.
            drafts.append(
                {
                    "subject_id": learner_id,
                    "predicate": LearnerRelationType.USER_SUPPLIED.value,
                    "object_id": target_id,
                    "natural_language_description": (
                        "The learner supplied this topic; it remains an unverified candidate."
                    ),
                    "confidence": 1.0,
                    "source_turn_id": turn_id,
                }
            )
            replace_keys.append((LearnerRelationType.USER_SUPPLIED.value, learner_id, target_id))
        if goal_target_id != target_id:
            drafts.append(
                {
                    "subject_id": goal_target_id,
                    "predicate": LearnerRelationType.BLOCKED_BY_PREREQUISITE.value,
                    "object_id": target_id,
                    "natural_language_description": (
                        "The learner's goal is blocked by this prerequisite."
                    ),
                    "confidence": 1.0,
                    "source_turn_id": turn_id,
                }
            )
            replace_keys.append(
                (
                    LearnerRelationType.BLOCKED_BY_PREREQUISITE.value,
                    goal_target_id,
                    target_id,
                )
            )
        if context.evidence is not None:
            drafts.append(
                {
                    "subject_id": learner_id,
                    "predicate": LearnerRelationType.HAS_MASTERY_EVIDENCE.value,
                    "object_id": context.evidence.id,
                    "natural_language_description": context.evidence.grader_explanation,
                    "confidence": context.evidence.grader_confidence,
                    "source_turn_id": turn_id,
                    "mastery_evidence_id": context.evidence.id,
                }
            )
            for misconception in context.evidence.observed_misconceptions:
                drafts.append(
                    {
                        "subject_id": learner_id,
                        "predicate": LearnerRelationType.HAS_MISCONCEPTION.value,
                        "object_id": target_id,
                        "natural_language_description": misconception,
                        "confidence": context.evidence.grader_confidence,
                        "source_turn_id": turn_id,
                        "mastery_evidence_id": context.evidence.id,
                    }
                )
        update = context.mastery_update
        if update is not None:
            if update.promotion_eligible:
                drafts.append(
                    {
                        "subject_id": learner_id,
                        "predicate": LearnerRelationType.READY_FOR_PROMOTION.value,
                        "object_id": target_id,
                        "natural_language_description": (
                            "Evidence satisfies the deterministic promotion policy."
                        ),
                        "confidence": confidence,
                        "source_turn_id": turn_id,
                    }
                )
            if update.decision is MasteryDecision.REVIEW_PREREQUISITE:
                drafts.append(
                    {
                        "subject_id": learner_id,
                        "predicate": LearnerRelationType.REQUIRES_REVIEW.value,
                        "object_id": target_id,
                        "natural_language_description": (
                            "The learner needs prerequisite review before continuing."
                        ),
                        "confidence": confidence,
                        "source_turn_id": turn_id,
                    }
                )
            if update.decision in {
                MasteryDecision.REQUEST_MORE_EVIDENCE,
                MasteryDecision.REMEDIATE,
                MasteryDecision.CHANGE_EXPLANATION,
            }:
                drafts.append(
                    {
                        "subject_id": learner_id,
                        "predicate": LearnerRelationType.NEEDS_TRANSFER_EVIDENCE.value,
                        "object_id": target_id,
                        "natural_language_description": (
                            "Additional independent evidence is required."
                        ),
                        "confidence": confidence,
                        "source_turn_id": turn_id,
                    }
                )
        summary: dict[str, object] = {
            "target_knowledge_point_id": str(target_id),
            "knowledge_point_id": str(current_state.knowledge_point_id),
            "assertion_count": len(drafts),
            "mastery_score": current_state.mastery_score,
            "current_level": int(current_state.current_level),
            "decision": update.decision.value if update is not None else MasteryDecision.HOLD.value,
            "turn_id": str(turn_id),
        }
        return drafts, replace_keys, summary

    async def _is_mastered(self, learner_id: UUID, knowledge_point_id: UUID) -> bool:
        async with self.runtime.database.session() as session:
            record = await session.scalar(
                select(LearnerStateRecord).where(
                    LearnerStateRecord.learner_id == learner_id,
                    LearnerStateRecord.knowledge_point_id == knowledge_point_id,
                )
            )
        return record is not None and record.mastery_score >= 0.75 and record.current_level >= 2

    async def _ordered_prerequisite_status(
        self,
        *,
        learner_id: UUID,
        workspace_id: UUID,
        target_id: UUID,
        assertions: list[RelationAssertion],
        max_depth: int,
    ) -> tuple[dict[UUID, bool], dict[UUID, tuple[int, float, int, int]]]:
        """Return a bounded prerequisite chain in a stable, learner-aware order.

        The old implementation used a UUID-to-UUID dictionary comprehension,
        silently dropping all but one ``REQUIRES`` edge.  We retain a mapping
        for the controller API, but construct it from a list and sort by the
        deterministic policy: unmastered first, lowest mastery, shortest
        prerequisite distance, graph definition order, then UUID.
        """

        chain: list[tuple[int, UUID]] = []
        seen: set[UUID] = set()
        seen.add(target_id)
        frontier = {target_id}
        for _depth in range(max_depth):
            next_frontier: set[UUID] = set()
            for definition_index, assertion in enumerate(assertions):
                if (
                    assertion.is_active
                    and assertion.subject_id in frontier
                    and assertion.predicate_key.value == "REQUIRES"
                    and assertion.object_id not in seen
                ):
                    seen.add(assertion.object_id)
                    next_frontier.add(assertion.object_id)
                    chain.append((definition_index, assertion.object_id))
            if not next_frontier:
                break
            frontier = next_frontier
        if not chain:
            return {}, {}
        ids = [item[1] for item in chain]
        async with self.runtime.database.session() as session:
            records = list(
                (
                    await session.scalars(
                        select(LearnerStateRecord).where(
                            LearnerStateRecord.learner_id == learner_id,
                            LearnerStateRecord.workspace_id == workspace_id,
                            LearnerStateRecord.knowledge_point_id.in_(ids),
                        )
                    )
                ).all()
            )
        state_by_id = {record.knowledge_point_id: record for record in records}
        distances = _prerequisite_distances(target_id, assertions, max_depth=max_depth)
        priorities = {
            knowledge_point_id: (
                0 if knowledge_point_id not in state_by_id else 1,
                state_by_id[knowledge_point_id].mastery_score
                if knowledge_point_id in state_by_id
                else 0.0,
                distances.get(knowledge_point_id, max_depth + 1),
                definition_index,
            )
            for definition_index, knowledge_point_id in chain
        }
        ordered = sorted(
            chain,
            key=lambda item: (
                priorities[item[1]],
                str(item[1]),
            ),
        )
        return (
            {
                knowledge_point_id: _record_is_mastered(state_by_id.get(knowledge_point_id))
                for _, knowledge_point_id in ordered
            },
            priorities,
        )

    async def _load_learner_context(
        self,
        context: ChatTurnContext,
        knowledge_point_id: UUID,
    ) -> None:
        async with self.runtime.database.unit_of_work() as unit:
            record = await unit.learner_states.get_or_create(
                workspace_id=context.request.workspace_id,
                learner_id=context.request.learner_id,
                knowledge_point_id=knowledge_point_id,
            )
            history_records = await unit.learner_states.list_evidence(
                context.request.learner_id,
                knowledge_point_id=knowledge_point_id,
                limit=1000,
                workspace_id=context.request.workspace_id,
            )
            context.learner_state_record = record
            latest_learner_revision = await unit.learner_graph.latest_revision(
                context.request.learner_id,
                workspace_id=context.request.workspace_id,
            )
            context.learner_graph_revision_id = (
                latest_learner_revision.id if latest_learner_revision is not None else None
            )
            context.learner_state = _state_from_record(record)
            context.evidence_history = [
                _evidence_from_record(item) for item in reversed(history_records)
            ]
            await unit.commit()

    @staticmethod
    def _context(state: WorkflowState) -> ChatTurnContext:
        value = state.get("context")
        if not isinstance(value, ChatTurnContext):
            raise TypeError("workflow state does not contain ChatTurnContext")
        return value

    @staticmethod
    def _prior_target(context: ChatTurnContext) -> UUID | None:
        if context.prior_assistant is None:
            return None
        return context.prior_assistant.target_knowledge_point_id

    @staticmethod
    def _prior_hint_level(turn: ConversationTurn | None) -> HintLevel | None:
        if turn is None:
            return None
        raw = turn.metadata_json.get("hint_level")
        if raw is None and turn.assessment is not None:
            raw = turn.assessment.get("hint_level")
        try:
            return HintLevel(int(raw)) if raw is not None else None
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _prior_session_goal(context: ChatTurnContext) -> UUID | None:
        if context.prior_assistant is None:
            return None
        raw = context.prior_assistant.metadata_json.get("session_goal_knowledge_point_id")
        if raw is None:
            return context.prior_assistant.target_knowledge_point_id
        try:
            return UUID(str(raw))
        except ValueError:
            return context.prior_assistant.target_knowledge_point_id

    @staticmethod
    def _looks_like_learning_request(message: str) -> bool:
        return _LEARNING_REQUEST_PATTERN.search(message) is not None

    @staticmethod
    def _is_pure_self_report(message: str) -> bool:
        return _PURE_SELF_REPORT_PATTERN.fullmatch(message) is not None

    async def _find_semantic_target(
        self,
        snapshot: GraphSnapshot,
        message: str,
    ) -> GraphNode | None:
        normalized_message = " ".join(message.casefold().split())
        terms = self._search_terms(normalized_message)
        query = " ".join(terms) or normalized_message[:500]
        semantic = await self.runtime.semantic_queries.search_knowledge_points(
            SearchKnowledgePointsParams(
                workspace_id=snapshot.workspace_id,
                query=query,
                limit=50,
            )
        )
        if semantic.graph_revision_id != snapshot.revision_id:
            await self.runtime.outbox_dispatcher.dispatch_once(
                batch_size=self.runtime.settings.outbox_batch_size
            )
            semantic = await self.runtime.semantic_queries.search_knowledge_points(
                SearchKnowledgePointsParams(
                    workspace_id=snapshot.workspace_id,
                    query=query,
                    limit=50,
                )
            )
        if semantic.graph_revision_id != snapshot.revision_id:
            raise RuntimeError("semantic graph projection is behind the committed graph revision")
        semantic_ids = _uuid_ids_from_records(semantic.data.get("nodes"))
        if semantic_ids:
            semantic_snapshot = snapshot.model_copy(
                update={"nodes": [node for node in snapshot.nodes if node.id in semantic_ids]}
            )
            matched = self._find_target(semantic_snapshot, message)
            if matched is not None:
                return matched
            if len(semantic_ids) == 1:
                return snapshot.node_map().get(next(iter(semantic_ids)))
        # The provider's substring search is deliberately conservative. The bounded
        # local score is a deterministic fallback for languages without word boundaries.
        return self._find_target(snapshot, message)

    @classmethod
    def _find_target(cls, snapshot: GraphSnapshot, message: str) -> GraphNode | None:
        nodes = [node for node in snapshot.nodes if node.node_type is NodeType.KNOWLEDGE_POINT]
        return cls._select_target(nodes, message, allow_unmatched=False)

    @classmethod
    def _select_target(
        cls,
        nodes: list[GraphNode],
        message: str,
        *,
        allow_unmatched: bool,
    ) -> GraphNode | None:
        """Rank only caller-scoped candidates, with deterministic tie-breaking.

        ``allow_unmatched`` is reserved for candidates extracted from the current
        chat input. Every such candidate is source-linked to that input, so choosing
        the most important candidate is safer than selecting an unrelated node from
        the wider workspace when a model used a translated or expanded name.
        """

        normalized_message = " ".join(message.casefold().split())
        message_compact = cls._compact_search_text(normalized_message)
        terms = cls._search_terms(normalized_message)
        topic_compact = "".join(cls._compact_search_text(term) for term in terms)
        scored: list[tuple[int, float, float, str, GraphNode]] = []
        for node in nodes:
            names = [
                str(node.properties.get(key, ""))
                for key in (
                    "canonical_name",
                    "display_name",
                )
                if isinstance(node.properties.get(key), str)
            ]
            aliases = node.properties.get("aliases")
            if isinstance(aliases, list):
                names.extend(str(alias) for alias in aliases if isinstance(alias, str))
            text_values = [
                str(node.properties.get(key, ""))
                for key in (
                    "canonical_name",
                    "display_name",
                    "summary",
                    "plain_language_definition",
                    "formal_definition",
                )
                if isinstance(node.properties.get(key), str)
            ]
            for key in ("must_cover", "applicability"):
                value = node.properties.get(key)
                if isinstance(value, list):
                    text_values.extend(str(item) for item in value if isinstance(item, str))
            text = " ".join(text_values).casefold()
            compact_names = [cls._compact_search_text(name) for name in names if name]
            name_score = 0
            for compact_name in compact_names:
                if not compact_name:
                    continue
                if topic_compact and compact_name == topic_compact:
                    name_score = max(name_score, 400)
                elif compact_name in message_compact:
                    name_score = max(name_score, 300)
                elif topic_compact and topic_compact in compact_name:
                    name_score = max(name_score, 250)
            term_score = sum(20 * text.count(term) for term in terms)
            relevance = name_score + term_score
            if relevance or allow_unmatched:
                importance_value = node.properties.get("importance", 0.0)
                importance = (
                    float(importance_value)
                    if isinstance(importance_value, int | float)
                    and not isinstance(importance_value, bool)
                    else 0.0
                )
                scored.append(
                    (
                        relevance,
                        importance,
                        node.source_confidence,
                        str(node.id),
                        node,
                    )
                )
        if not scored:
            return None
        return sorted(
            scored,
            key=lambda item: (-item[0], -item[1], -item[2], item[3]),
        )[0][4]

    @staticmethod
    def _compact_search_text(value: str) -> str:
        return "".join(character for character in value.casefold() if character.isalnum())

    @staticmethod
    def _search_terms(message: str) -> list[str]:
        normalized = " ".join(message.casefold().split())
        segmented = _CJK_ASCII_BOUNDARY_PATTERN.sub(" ", normalized)
        terms: list[str] = []
        for raw_term in _SEARCH_TOKEN_PATTERN.findall(segmented):
            term = raw_term
            prefix_removed = True
            while prefix_removed and term:
                prefix_removed = False
                for prefix in _CJK_LEARNING_PREFIXES:
                    if term.startswith(prefix) and term != prefix:
                        term = term[len(prefix) :]
                        prefix_removed = True
                        break
            if len(term) > 1 and term not in _SEARCH_STOP_WORDS and term not in terms:
                terms.append(term)
        return terms

    @staticmethod
    def _node_name(node: GraphNode) -> str:
        for key in ("display_name", "canonical_name", "name"):
            value = node.properties.get(key)
            if isinstance(value, str) and value:
                return value
        return str(node.id)

    @staticmethod
    def _next_evidence_type(
        context: ChatTurnContext,
        level: CognitiveLevel,
    ) -> EvidenceType:
        forms = _EVIDENCE_FORMS[level]
        relevant = [
            item
            for item in context.evidence_history
            if item.cognitive_level is level and item.evidence_type in forms
        ]
        counts = {form: sum(item.evidence_type is form for item in relevant) for form in forms}
        return min(forms, key=lambda form: (counts[form], forms.index(form)))

    @staticmethod
    def _teaching_stage(
        snapshot: GraphSnapshot,
        knowledge_point_id: UUID,
        level: CognitiveLevel,
    ) -> JsonObject:
        for node in snapshot.nodes:
            if node.node_type is not NodeType.LEARNING_STAGE:
                continue
            if str(node.properties.get("knowledge_point_id", "")) != str(knowledge_point_id):
                continue
            raw_level = node.properties.get("cognitive_level")
            try:
                if int(str(raw_level)) == int(level):
                    return dict(node.properties)
            except (TypeError, ValueError):
                continue
        return {
            "knowledge_point_id": str(knowledge_point_id),
            "cognitive_level": int(level),
        }

    @staticmethod
    def _node_definition(node: GraphNode) -> str:
        for key in (
            "formal_definition",
            "plain_language_definition",
            "summary",
        ):
            value = node.properties.get(key)
            if isinstance(value, str) and value.strip():
                return value
        return ""

    @staticmethod
    def _node_string_list(node: GraphNode, key: str) -> list[str]:
        value = node.properties.get(key)
        if not isinstance(value, list):
            return []
        return [item for item in value if isinstance(item, str) and item.strip()]

    @staticmethod
    def _stage_list(stage: JsonObject, *keys: str) -> list[str]:
        for key in keys:
            value = stage.get(key)
            if isinstance(value, list):
                selected = [item for item in value if isinstance(item, str) and item.strip()]
                if selected:
                    return selected
        return []

    @staticmethod
    def _source_context(snapshot: GraphSnapshot, node: GraphNode) -> list[JsonObject]:
        source_ids = set(node.source_span_ids)
        selected = sorted(
            (span for span in snapshot.source_spans if span.id in source_ids),
            key=lambda span: (str(span.document_id), span.page_number or 0, str(span.id)),
        )[:5]
        return [
            {
                "source_span_id": str(span.id),
                "document_id": str(span.document_id),
                "page_number": span.page_number,
                "heading_path": list(span.heading_path),
                "excerpt": span.text[:1000],
                "parser_name": span.parser_name,
                "parser_version": span.parser_version,
            }
            for span in selected
        ]

    @staticmethod
    def _criteria(context: ChatTurnContext) -> list[str]:
        if context.directive is None or context.bundle is None:
            return ["correct response with a reason"]
        stage = context.bundle.current_teaching_stage
        criteria = ChatService._stage_list(stage, "mastery_criteria")
        must_cover = ChatService._stage_list(stage, "must_cover", "must_cover_items")
        criteria.extend(f"addresses the required element: {item}" for item in must_cover)
        return criteria or [
            f"fulfills the {context.directive.assessment_type.value} rubric with a reason"
        ]


def _uuid_ids_from_records(value: object) -> set[UUID]:
    if not isinstance(value, list):
        return set()
    identifiers: set[UUID] = set()
    for item in value:
        if not isinstance(item, Mapping):
            continue
        raw_id = item.get("id")
        if raw_id is None:
            continue
        try:
            identifiers.add(UUID(str(raw_id)))
        except ValueError:
            continue
    return identifiers


def _ordered_prerequisite_ids(
    target_id: UUID,
    assertions: list[RelationAssertion],
    *,
    max_depth: int,
) -> list[UUID]:
    ordered: list[UUID] = []
    seen = {target_id}
    frontier = {target_id}
    requires = sorted(
        (
            assertion
            for assertion in assertions
            if assertion.is_active and assertion.predicate_key.value == "REQUIRES"
        ),
        key=lambda assertion: str(assertion.id),
    )
    for _depth in range(max_depth):
        next_frontier: set[UUID] = set()
        for assertion in requires:
            if assertion.subject_id not in frontier or assertion.object_id in seen:
                continue
            seen.add(assertion.object_id)
            ordered.append(assertion.object_id)
            next_frontier.add(assertion.object_id)
        if not next_frontier:
            break
        frontier = next_frontier
    return ordered


def _record_is_mastered(record: LearnerStateRecord | None) -> bool:
    return record is not None and record.mastery_score >= 0.75 and record.current_level >= 2


def _prerequisite_distances(
    target_id: UUID,
    assertions: list[RelationAssertion],
    *,
    max_depth: int,
) -> dict[UUID, int]:
    """Compute shortest prerequisite distance without loading another graph."""

    requires_by_subject: dict[UUID, list[UUID]] = {}
    for assertion in sorted(
        (item for item in assertions if item.is_active and item.predicate_key.value == "REQUIRES"),
        key=lambda item: str(item.id),
    ):
        requires_by_subject.setdefault(assertion.subject_id, []).append(assertion.object_id)
    distances: dict[UUID, int] = {}
    frontier = [target_id]
    for depth in range(1, max_depth + 1):
        next_frontier: list[UUID] = []
        for subject_id in frontier:
            for prerequisite_id in requires_by_subject.get(subject_id, []):
                if prerequisite_id in distances or prerequisite_id == target_id:
                    continue
                distances[prerequisite_id] = depth
                next_frontier.append(prerequisite_id)
        if not next_frontier:
            break
        frontier = next_frontier
    return distances


def _context_node(node: GraphNode, *, relevance: float) -> ContextNode:
    return ContextNode(
        id=node.id,
        node_type=node.node_type.value,
        name=next(
            (
                value
                for key in ("display_name", "canonical_name", "name", "content", "statement")
                if isinstance((value := node.properties.get(key)), str) and value
            ),
            str(node.id),
        ),
        summary=str(node.properties.get("plain_language_definition", "")),
        properties=node.properties,
        relevance=relevance,
    )


def _state_from_record(record: LearnerStateRecord) -> LearnerKnowledgeState:
    return LearnerKnowledgeState(
        id=record.id,
        learner_id=record.learner_id,
        knowledge_point_id=record.knowledge_point_id,
        current_level=CognitiveLevel(record.current_level),
        mastery_score=record.mastery_score,
        confidence=record.confidence,
        evidence_count=record.evidence_count,
        independent_success_count=record.independent_success_count,
        reasoning_success_count=record.reasoning_success_count,
        transfer_success_count=record.transfer_success_count,
        critical_misconceptions=record.critical_misconceptions,
        last_interaction_at=record.last_interaction_at,
        next_review_at=record.next_review_at,
        version=record.version,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _evidence_from_record(record: EvidenceRecord) -> MasteryEvidence:
    return MasteryEvidence(
        id=record.id,
        learner_id=record.learner_id,
        knowledge_point_id=record.knowledge_point_id,
        session_id=record.session_id,
        turn_id=record.turn_id,
        evidence_type=EvidenceType(record.evidence_type),
        cognitive_level=CognitiveLevel(record.cognitive_level),
        correctness_score=record.correctness_score,
        reasoning_score=record.reasoning_score,
        independence_score=record.independence_score,
        transfer_score=record.transfer_score,
        grader_confidence=record.grader_confidence,
        observed_misconceptions=record.observed_misconceptions,
        raw_answer=record.raw_answer,
        grader_explanation=record.grader_explanation,
        created_at=record.created_at,
    )


def _update_record(record: LearnerStateRecord, state: LearnerKnowledgeState) -> None:
    record.current_level = int(state.current_level)
    record.mastery_score = state.mastery_score
    record.confidence = state.confidence
    record.evidence_count = state.evidence_count
    record.independent_success_count = state.independent_success_count
    record.reasoning_success_count = state.reasoning_success_count
    record.transfer_success_count = state.transfer_success_count
    record.critical_misconceptions = state.critical_misconceptions
    record.last_interaction_at = state.last_interaction_at
    record.next_review_at = state.next_review_at
    record.version = state.version


def _evidence_record(evidence: MasteryEvidence, workspace_id: UUID) -> EvidenceRecord:
    return EvidenceRecord(
        id=evidence.id,
        workspace_id=workspace_id,
        learner_id=evidence.learner_id,
        knowledge_point_id=evidence.knowledge_point_id,
        session_id=evidence.session_id,
        turn_id=evidence.turn_id,
        evidence_type=evidence.evidence_type.value,
        cognitive_level=int(evidence.cognitive_level),
        correctness_score=evidence.correctness_score,
        reasoning_score=evidence.reasoning_score,
        independence_score=evidence.independence_score,
        transfer_score=evidence.transfer_score,
        grader_confidence=evidence.grader_confidence,
        observed_misconceptions=evidence.observed_misconceptions,
        raw_answer=evidence.raw_answer,
        grader_explanation=evidence.grader_explanation,
        created_at=evidence.created_at,
    )
