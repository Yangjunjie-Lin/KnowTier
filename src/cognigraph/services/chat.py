from __future__ import annotations

import asyncio
import json
import re
import threading
import weakref
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import cast
from uuid import UUID

from sqlalchemy import select

from cognigraph.api.schemas import (
    AssessmentResponse,
    ChatRequest,
    ChatResponse,
    GraphUpdateResponse,
    LearnerUpdateResponse,
    TargetKnowledgePointResponse,
)
from cognigraph.domain.base import JsonObject
from cognigraph.domain.documents import IngestionReport
from cognigraph.domain.enums import (
    CognitiveLevel,
    EvidenceType,
    HintLevel,
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
from cognigraph.graph.manifest import GraphManifestService
from cognigraph.graph.query_tools import FocusSubgraphParams, SearchKnowledgePointsParams
from cognigraph.learner.rule_estimator import EvidenceRuleEstimator
from cognigraph.llm.schemas import ChatMessage, ModelCallContext, ModelRole, TeacherOutput
from cognigraph.persistence.postgres.models import ConversationTurn
from cognigraph.persistence.postgres.models import (
    LearnerKnowledgeState as LearnerStateRecord,
)
from cognigraph.persistence.postgres.models import (
    MasteryEvidence as EvidenceRecord,
)
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
    sources: list[dict[str, object]] = field(default_factory=list)
    response: ChatResponse | None = None


class ChatService:
    def __init__(self, runtime: ApplicationRuntime) -> None:
        self.runtime = runtime
        self.controller = TeachingController()
        self.compiler = GraphContextCompiler()
        self.manifest_service = GraphManifestService()
        self.evaluator = ResponseEvaluator(runtime.model_gateway)
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
            context = ChatTurnContext(request=request)
            state: WorkflowState = {"context": context}
            result = await self.workflow.run(state, checkpoint_id=str(request.session_id))
            final_context = cast(ChatTurnContext, result["context"])
            if final_context.response is None:
                raise RuntimeError("teaching workflow completed without a response")
            return final_context.response

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
                limit=self.runtime.settings.recent_turn_limit,
            )
            context.prior_assistant = next(
                (turn for turn in reversed(context.recent_turns) if turn.role == "assistant"),
                None,
            )
            context.previous_hint_level = self._prior_hint_level(context.prior_assistant)
            context.user_turn = await unit.turns.add(
                workspace_id=request.workspace_id,
                learner_id=request.learner_id,
                session_id=session.id,
                role="user",
                content=request.message,
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
                context.graph_report = await self.runtime.ingestion.ingest(upload.document_id)
                snapshot = await self.runtime.ensure_graph_loaded(request.workspace_id)
                target = await self._find_semantic_target(snapshot, request.message)
                if target is None:
                    newly_added = [
                        node
                        for node in snapshot.nodes
                        if node.node_type is NodeType.KNOWLEDGE_POINT
                        and node.id not in existing_knowledge_ids
                    ]
                    if len(newly_added) == 1:
                        target = newly_added[0]
            context.target_node = target
            context.session_goal_knowledge_point_id = target.id if target is not None else None
            context.previous_hint_level = None
        else:
            context.target_node = (
                snapshot.node_map().get(prior_target_id) if prior_target_id is not None else None
            )
            context.session_goal_knowledge_point_id = self._prior_session_goal(context)
        if context.target_node is None:
            raise LookupError("no teachable knowledge point could be selected")
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
        prerequisites = {
            assertion.object_id: await self._is_mastered(
                context.request.learner_id,
                assertion.object_id,
            )
            for assertion in snapshot.assertions
            if assertion.is_active
            and assertion.subject_id == context.target_node.id
            and assertion.predicate_key.value == "REQUIRES"
        }
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
                max_depth=min(self.runtime.settings.graph_max_depth, 3),
                max_nodes=min(self.runtime.settings.graph_max_nodes, 100),
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
                    max_depth=min(self.runtime.settings.graph_max_depth, 3),
                    max_nodes=min(self.runtime.settings.graph_max_nodes, 100),
                )
            )
        if semantic_focus.graph_revision_id != snapshot.revision_id:
            raise RuntimeError("semantic graph projection is behind the committed graph revision")

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
            max_depth=min(self.runtime.settings.graph_max_depth, 3),
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
                token_budget=self.runtime.settings.context_token_budget,
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
        teacher, _result = await self.runtime.model_gateway.generate_structured(
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
            response_model=TeacherOutput,
            context=ModelCallContext(
                workspace_id=context.request.workspace_id,
                learner_id=context.request.learner_id,
                session_id=context.request.session_id,
                turn_id=context.user_turn.id if context.user_turn is not None else None,
                graph_revision_id=context.bundle.graph_revision,
                prompt_name=prompt.name,
                prompt_version=prompt.version,
            ),
        )
        teacher.assessment.type = context.directive.assessment_type
        context.teacher_output = teacher
        return state

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
            await unit.commit()
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
            sources=context.sources,
        )
        return state

    async def _is_mastered(self, learner_id: UUID, knowledge_point_id: UUID) -> bool:
        async with self.runtime.database.session() as session:
            record = await session.scalar(
                select(LearnerStateRecord).where(
                    LearnerStateRecord.learner_id == learner_id,
                    LearnerStateRecord.knowledge_point_id == knowledge_point_id,
                )
            )
        return record is not None and record.mastery_score >= 0.75 and record.current_level >= 2

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
            )
            context.learner_state_record = record
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
        terms = [
            term
            for term in _SEARCH_TOKEN_PATTERN.findall(normalized_message)
            if len(term) > 1 and term not in _SEARCH_STOP_WORDS
        ]
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

    @staticmethod
    def _find_target(snapshot: GraphSnapshot, message: str) -> GraphNode | None:
        nodes = [node for node in snapshot.nodes if node.node_type is NodeType.KNOWLEDGE_POINT]
        normalized_message = " ".join(message.casefold().split())
        terms = [
            term
            for term in _SEARCH_TOKEN_PATTERN.findall(normalized_message)
            if len(term) > 1 and term not in _SEARCH_STOP_WORDS
        ]
        scored: list[tuple[int, GraphNode]] = []
        for node in nodes:
            names = [
                str(node.properties.get(key, ""))
                for key in (
                    "canonical_name",
                    "display_name",
                )
                if isinstance(node.properties.get(key), str)
            ]
            text = " ".join(
                str(node.properties.get(key, ""))
                for key in (
                    "canonical_name",
                    "display_name",
                    "summary",
                    "plain_language_definition",
                )
            ).casefold()
            exact_name_score = sum(
                100
                for name in names
                if name and " ".join(name.casefold().split()) in normalized_message
            )
            score = exact_name_score + sum(text.count(term) for term in terms)
            if score:
                scored.append((score, node))
        if scored:
            return sorted(scored, key=lambda item: (-item[0], str(item[1].id)))[0][1]
        return None

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
