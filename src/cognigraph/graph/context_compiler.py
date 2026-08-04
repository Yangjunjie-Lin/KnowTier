"""Deterministic compilation of bounded graph and conversation context."""

from __future__ import annotations

import json
import math
from collections.abc import Callable, Iterable
from uuid import UUID

from pydantic import Field

from cognigraph.domain.base import DomainModel, JsonObject
from cognigraph.domain.graph import GraphManifest
from cognigraph.domain.teaching import (
    ContextAssertion,
    ContextBundle,
    ContextNode,
    LearnerMasterySummary,
    RecentTurn,
    SessionGoal,
    SourceEvidence,
    TeachingPolicy,
)


class ContextCompilationRequest(DomainModel):
    workspace_id: UUID
    learner_id: UUID
    session_id: UUID
    user_message: str = Field(min_length=1)
    target_knowledge_point_id: UUID | None = None
    token_budget: int = Field(ge=32)


class ContextCandidates(DomainModel):
    """Pre-fetched candidates grouped in explicit pedagogical priority order."""

    current_knowledge_point: ContextNode | None = None
    prerequisite_chain: list[ContextNode] = Field(default_factory=list)
    direct_dependencies: list[ContextNode] = Field(default_factory=list)
    relevant_misconceptions: list[str] = Field(default_factory=list)
    examples: list[ContextNode] = Field(default_factory=list)
    counterexamples: list[ContextNode] = Field(default_factory=list)
    supporting_sources: list[SourceEvidence] = Field(default_factory=list)
    adjacent_theories: list[ContextNode] = Field(default_factory=list)
    focus_assertions: list[ContextAssertion] = Field(default_factory=list)
    learner_mastery: list[LearnerMasterySummary] = Field(default_factory=list)
    current_teaching_stage: JsonObject = Field(default_factory=dict)
    recent_turns: list[RecentTurn] = Field(default_factory=list)


class GraphContextCompiler:
    """Compile only relevant graph context without re-summarizing history."""

    def compile(
        self,
        request: ContextCompilationRequest,
        manifest: GraphManifest,
        candidates: ContextCandidates,
        session_goal: SessionGoal,
        teaching_policy: TeachingPolicy,
    ) -> ContextBundle:
        if manifest.workspace_id != request.workspace_id:
            raise ValueError("manifest workspace does not match context request")
        budget = request.token_budget
        used = (
            _token_cost(request.user_message)
            + _token_cost(manifest)
            + _token_cost(session_goal)
            + _token_cost(teaching_policy)
            + _token_cost(candidates.current_teaching_stage)
        )
        if used > budget:
            raise ValueError("token budget is too small for the session goal and teaching policy")

        focus_nodes: list[ContextNode] = []
        prerequisite_chain: list[ContextNode] = []
        misconceptions: list[str] = []
        sources: list[SourceEvidence] = []
        assertions: list[ContextAssertion] = []
        mastery: list[LearnerMasterySummary] = []
        recent_turns: list[RecentTurn] = []
        truncated = False
        seen_nodes: set[UUID] = set()

        def reserve(value: DomainModel | str) -> bool:
            nonlocal truncated, used
            cost = _token_cost(value)
            if used + cost <= budget:
                used += cost
                return True
            truncated = True
            return False

        if candidates.current_knowledge_point is not None:
            if reserve(candidates.current_knowledge_point):
                focus_nodes.append(candidates.current_knowledge_point)
                seen_nodes.add(candidates.current_knowledge_point.id)

        for node in _stable_nodes(candidates.prerequisite_chain):
            if node.id in seen_nodes:
                continue
            if reserve(node):
                focus_nodes.append(node)
                seen_nodes.add(node.id)
                prerequisite_chain.append(node)

        for node in _stable_nodes(candidates.direct_dependencies):
            if node.id not in seen_nodes:
                if reserve(node):
                    focus_nodes.append(node)
                    seen_nodes.add(node.id)
        for item in candidates.relevant_misconceptions:
            if reserve(item):
                misconceptions.append(item)
        for node in _stable_nodes([*candidates.examples, *candidates.counterexamples]):
            if node.id not in seen_nodes:
                if reserve(node):
                    focus_nodes.append(node)
                    seen_nodes.add(node.id)
        ordered_sources = _stable_models(
            candidates.supporting_sources,
            lambda item: item.source_span_id,
        )
        for source in ordered_sources:
            if reserve(source):
                sources.append(source)
        for node in _stable_nodes(candidates.adjacent_theories):
            if node.id not in seen_nodes:
                if reserve(node):
                    focus_nodes.append(node)
                    seen_nodes.add(node.id)
        for assertion in _stable_models(candidates.focus_assertions, lambda item: item.id):
            if assertion.subject_id in seen_nodes and assertion.object_id in seen_nodes:
                if reserve(assertion):
                    assertions.append(assertion)
        ordered_mastery = _stable_models(
            candidates.learner_mastery,
            lambda item: item.knowledge_point_id,
        )
        for state in ordered_mastery:
            if reserve(state):
                mastery.append(state)

        turns = sorted(
            candidates.recent_turns,
            key=lambda turn: (turn.created_at, str(turn.turn_id)),
        )
        for turn in reversed(turns):
            cost = _token_cost(turn)
            if used + cost <= budget:
                used += cost
                recent_turns.append(turn)
            else:
                truncated = True
        recent_turns.reverse()

        return ContextBundle(
            graph_revision=manifest.revision_id,
            global_manifest=manifest,
            focus_nodes=focus_nodes,
            focus_assertions=assertions,
            prerequisite_chain=prerequisite_chain,
            learner_mastery=mastery,
            relevant_misconceptions=misconceptions,
            supporting_sources=sources,
            current_teaching_stage=candidates.current_teaching_stage,
            session_goal=session_goal,
            teaching_policy=teaching_policy,
            allowed_next_actions=teaching_policy.allowed_next_actions,
            recent_turn_window=recent_turns,
            estimated_tokens=used,
            truncated=truncated,
        )


def _token_cost(value: DomainModel | JsonObject | str) -> int:
    """Conservative and provider-independent four-UTF-8-bytes token approximation."""

    if isinstance(value, str):
        serialized = value
    elif isinstance(value, DomainModel):
        serialized = json.dumps(
            value.model_dump(mode="json"), ensure_ascii=False, separators=(",", ":"), sort_keys=True
        )
    else:
        serialized = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return max(1, math.ceil(len(serialized.encode("utf-8")) / 4))


def _stable_nodes(nodes: Iterable[ContextNode]) -> list[ContextNode]:
    return sorted(nodes, key=lambda node: (-node.relevance, str(node.id)))


def _stable_models[T](values: Iterable[T], key: Callable[[T], object]) -> list[T]:
    return sorted(values, key=lambda value: str(key(value)))
