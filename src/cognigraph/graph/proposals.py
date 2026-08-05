"""Model-generated graph comparison proposals.

The graph model is deliberately a read-only advisor.  These contracts describe
possible matches and conflicts, but they never contain an operation that can
write to either graph.  The deterministic delta builder remains the only write
authority.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from typing import Protocol
from uuid import UUID

from pydantic import ConfigDict, Field, model_validator

from cognigraph.domain.base import DomainModel
from cognigraph.domain.enums import RelationTypeKey
from cognigraph.graph.applier import GraphNode, GraphSnapshot
from cognigraph.llm.schemas import (
    ChatMessage,
    ModelCallContext,
    ModelRole,
    StructuredCallResult,
)
from cognigraph.prompts import PromptManager


class EquivalentCandidate(DomainModel):
    """A candidate entity that may be equivalent to an existing node."""

    model_config = ConfigDict(extra="ignore")

    candidate_key: str | None = None
    candidate_node_id: UUID | None = None
    existing_node_id: UUID | None = None
    similarity: float = Field(default=0.0, ge=0.0, le=1.0)
    reason: str = ""
    requires_review: bool = True

    @model_validator(mode="after")
    def has_endpoints(self) -> EquivalentCandidate:
        if self.candidate_key is None and self.candidate_node_id is None:
            raise ValueError("equivalent candidate needs a candidate key or node id")
        return self


class ProposedMerge(DomainModel):
    """A read-only merge suggestion; it is never applied directly."""

    model_config = ConfigDict(extra="ignore")

    source_node_id: UUID
    target_node_id: UUID
    similarity: float = Field(ge=0.0, le=1.0)
    reason: str = Field(min_length=1)
    requires_review: bool = True

    @model_validator(mode="after")
    def distinct_nodes(self) -> ProposedMerge:
        if self.source_node_id == self.target_node_id:
            raise ValueError("merge candidates must refer to distinct nodes")
        return self


# The public name used in the architecture notes.  Keeping the concrete class
# separate from ``graph.delta.MergeCandidate`` avoids accidentally treating a
# model suggestion as an executable delta field.
MergeCandidate = ProposedMerge


class RelationCandidate(DomainModel):
    """A possible relation between already known or candidate entities."""

    model_config = ConfigDict(extra="ignore")

    subject_id: UUID | None = None
    object_id: UUID | None = None
    subject_candidate_id: str | None = None
    object_candidate_id: str | None = None
    predicate: RelationTypeKey | str
    description: str = ""
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    requires_review: bool = True
    source_span_ids: list[UUID] = Field(default_factory=list)

    @model_validator(mode="after")
    def has_endpoints(self) -> RelationCandidate:
        if self.subject_id is None and self.subject_candidate_id is None:
            raise ValueError("relation candidate needs a subject")
        if self.object_id is None and self.object_candidate_id is None:
            raise ValueError("relation candidate needs an object")
        if self.subject_id is not None and self.object_id is not None:
            if self.subject_id == self.object_id:
                raise ValueError("relation candidate endpoints must differ")
        return self


class ConflictCandidate(DomainModel):
    """A possible conflict that requires deterministic validation/review."""

    model_config = ConfigDict(extra="ignore")

    conflict_type: str
    assertion_ids: list[UUID] = Field(default_factory=list)
    candidate_assertion_ids: list[UUID] = Field(default_factory=list)
    description: str = ""
    requires_review: bool = True


class TemporalReplacement(DomainModel):
    old_assertion_id: UUID
    replacement_assertion_id: UUID
    reason: str = ""
    requires_review: bool = True


class UnresolvedGraphItem(DomainModel):
    description: str = Field(min_length=1)
    candidate_keys: list[str] = Field(default_factory=list)
    reason: str | None = None


class GraphComparisonProposal(DomainModel):
    """Complete, bounded output accepted from a graph comparison model."""

    model_config = ConfigDict(extra="ignore")

    equivalent_candidates: list[EquivalentCandidate] = Field(default_factory=list)
    merge_candidates: list[ProposedMerge] = Field(default_factory=list)
    relation_candidates: list[RelationCandidate] = Field(default_factory=list)
    conflict_candidates: list[ConflictCandidate] = Field(default_factory=list)
    temporal_replacements: list[TemporalReplacement] = Field(default_factory=list)
    unresolved_items: list[UnresolvedGraphItem] = Field(default_factory=list)

    @model_validator(mode="after")
    def bounded_lists(self) -> GraphComparisonProposal:
        # Keep malformed model output from becoming an unbounded memory sink.
        for name in (
            "equivalent_candidates",
            "merge_candidates",
            "relation_candidates",
            "conflict_candidates",
            "temporal_replacements",
            "unresolved_items",
        ):
            if len(getattr(self, name)) > 500:
                raise ValueError(f"{name} exceeds the proposal limit")
        return self


class GraphProposalValidationError(ValueError):
    """Raised when a model proposal cannot be safely compared to a snapshot."""


class GraphProposalValidator:
    """Validate references without changing the canonical graph."""

    def validate(
        self,
        proposal: GraphComparisonProposal,
        *,
        workspace_id: UUID,
        snapshot: GraphSnapshot,
    ) -> GraphComparisonProposal:
        if snapshot.workspace_id != workspace_id:
            raise GraphProposalValidationError("snapshot belongs to a different workspace")
        node_ids = set(snapshot.node_map())
        assertion_ids = {item.id for item in snapshot.assertions}
        for equivalent in proposal.equivalent_candidates:
            if (
                equivalent.existing_node_id is not None
                and equivalent.existing_node_id not in node_ids
            ):
                raise GraphProposalValidationError("equivalent candidate references unknown node")
            if (
                equivalent.candidate_node_id is not None
                and equivalent.candidate_node_id not in node_ids
            ):
                # Candidate IDs may be new; only reject IDs that look like an attempted
                # cross-workspace reference when a workspace-qualified node is supplied.
                continue
        for merge in proposal.merge_candidates:
            if merge.source_node_id not in node_ids or merge.target_node_id not in node_ids:
                raise GraphProposalValidationError("merge candidate references unknown node")
        for conflict in proposal.conflict_candidates:
            if any(assertion_id not in assertion_ids for assertion_id in conflict.assertion_ids):
                raise GraphProposalValidationError(
                    "conflict candidate references unknown assertion"
                )
        source_span_ids = {span.id for span in snapshot.source_spans}
        for relation in proposal.relation_candidates:
            if relation.subject_id is not None and relation.subject_id not in node_ids:
                raise GraphProposalValidationError("relation candidate references unknown subject")
            if relation.object_id is not None and relation.object_id not in node_ids:
                raise GraphProposalValidationError("relation candidate references unknown object")
            if any(span_id not in source_span_ids for span_id in relation.source_span_ids):
                raise GraphProposalValidationError("relation candidate references unknown source")
        for replacement in proposal.temporal_replacements:
            if replacement.old_assertion_id not in assertion_ids:
                raise GraphProposalValidationError(
                    "temporal replacement references unknown assertion"
                )
        return proposal


class GraphComparisonProvider(Protocol):
    async def compare(
        self,
        *,
        workspace_id: UUID,
        candidate: object,
        snapshot: GraphSnapshot,
        context: ModelCallContext,
    ) -> tuple[GraphComparisonProposal, StructuredCallResult]: ...


class ModelGraphComparator:
    """Call the graph model as a bounded, read-only comparison step."""

    def __init__(self, gateway: object, prompts: PromptManager | None = None) -> None:
        self.gateway = gateway
        self.prompts = prompts or PromptManager()

    async def compare(
        self,
        *,
        workspace_id: UUID,
        candidate: object,
        snapshot: GraphSnapshot,
        context: ModelCallContext,
    ) -> tuple[GraphComparisonProposal, StructuredCallResult]:
        # Importing the gateway protocol here keeps this module usable by offline
        # tests and avoids a hard dependency on a concrete provider implementation.
        generate = getattr(self.gateway, "generate_structured", None)
        if generate is None:
            raise TypeError("gateway does not provide generate_structured")
        candidate_payload = _bounded_candidate_payload(candidate)
        node_payload, assertion_payload = _relevant_snapshot_payload(
            candidate_payload,
            snapshot,
            max_nodes=_graph_model_node_limit(self.gateway),
        )
        context_budget = _graph_model_context_budget(self.gateway)
        node_payload, assertion_payload, candidate_payload, context_truncated = (
            _fit_graph_model_payload(
                candidate_payload,
                node_payload,
                assertion_payload,
                max_tokens=context_budget,
            )
        )
        payload = {
            "candidate": candidate_payload,
            "existing_subgraph": {
                "revision_id": str(snapshot.revision_id) if snapshot.revision_id else None,
                "nodes": node_payload,
                "assertions": assertion_payload,
            },
            "context_budget": {
                "max_tokens": context_budget,
                "truncated": context_truncated,
            },
            "instruction": (
                "Return comparison suggestions only. Never emit Cypher, SQL, write operations, "
                "or claims that a suggestion has been applied."
            ),
        }
        prompt = self.prompts.load("graph_delta_builder")
        call_context = context.model_copy(
            update={
                "prompt_name": prompt.name,
                "prompt_version": prompt.version,
                "context_truncated": context.context_truncated or context_truncated,
            }
        )
        outcome = await generate(
            role=ModelRole.GRAPH,
            messages=[
                ChatMessage(role="system", content=prompt.content),
                ChatMessage(
                    role="user",
                    content=json.dumps(payload, default=str, ensure_ascii=False),
                ),
            ],
            response_model=GraphComparisonProposal,
            context=call_context,
        )
        if not isinstance(outcome, tuple) or len(outcome) != 2:
            raise TypeError("graph gateway returned an invalid structured result")
        proposal, result = outcome
        if not isinstance(proposal, GraphComparisonProposal):
            raise TypeError("graph gateway returned an invalid proposal")
        if not isinstance(result, StructuredCallResult):
            raise TypeError("graph gateway returned an invalid model call")
        result.context_truncated = context_truncated
        return proposal, result


def _graph_model_node_limit(gateway: object) -> int:
    settings = getattr(gateway, "settings", None)
    value = getattr(settings, "max_graph_nodes", getattr(settings, "graph_max_nodes", 100))
    return min(max(int(value), 1), 100)


def _graph_model_context_budget(gateway: object) -> int:
    settings = getattr(gateway, "settings", None)
    value = getattr(
        settings,
        "max_context_tokens",
        getattr(settings, "context_token_budget", 4_000),
    )
    return max(int(value), 32)


def _fit_graph_model_payload(
    candidate: object,
    nodes: list[dict[str, object]],
    assertions: list[dict[str, object]],
    *,
    max_tokens: int,
) -> tuple[list[dict[str, object]], list[dict[str, object]], object, bool]:
    """Fit graph-model input deterministically to the configured token budget."""

    node_items = list(nodes)
    assertion_items = list(assertions)
    candidate_value = candidate
    max_bytes = max_tokens * 4

    def payload_size() -> int:
        return len(
            json.dumps(
                {
                    "candidate": candidate_value,
                    "nodes": node_items,
                    "assertions": assertion_items,
                },
                default=str,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
        )

    truncated = False
    while payload_size() > max_bytes:
        truncated = True
        if assertion_items:
            assertion_items.pop()
            continue
        if node_items:
            node_items.pop()
            continue
        if isinstance(candidate_value, Mapping) and candidate_value:
            # Preserve deterministic insertion order while removing the least
            # significant tail fields from the already bounded candidate.
            candidate_value = {str(key): value for key, value in list(candidate_value.items())[:-1]}
            continue
        # A single unusually large scalar should never defeat the budget loop.
        candidate_value = str(candidate_value)[: max(1, max_bytes // 8)]
        if payload_size() > max_bytes:
            candidate_value = None
        break
    return node_items, assertion_items, candidate_value, truncated


def _bounded_candidate_payload(candidate: object) -> object:
    dump = getattr(candidate, "model_dump", None)
    raw = dump(mode="json") if callable(dump) else candidate

    def prune(value: object, *, depth: int = 0) -> object:
        if depth >= 6:
            return str(value)[:500]
        if isinstance(value, str):
            return value[:2_000]
        if isinstance(value, Mapping):
            return {
                str(key): prune(item, depth=depth + 1) for key, item in list(value.items())[:100]
            }
        if isinstance(value, list | tuple):
            return [prune(item, depth=depth + 1) for item in value[:50]]
        return value

    return prune(raw)


def _relevant_snapshot_payload(
    candidate: object,
    snapshot: GraphSnapshot,
    *,
    max_nodes: int,
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """Select a deterministic lexical neighborhood without loading it into the prompt."""

    candidate_text = json.dumps(candidate, default=str, ensure_ascii=False).casefold()
    terms = {
        token
        for token in re.findall(r"[\w-]{3,}", candidate_text)
        if token not in {"candidate", "source", "confidence", "description"}
    }
    ranked: list[tuple[int, str, GraphNode]] = []
    for node in snapshot.nodes:
        searchable = json.dumps(node.properties, default=str, ensure_ascii=False).casefold()
        score = sum(1 for term in terms if term in searchable)
        if score:
            ranked.append((score, str(node.id), node))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    selected = [item[2] for item in ranked[:max_nodes]]
    if not selected:
        selected = sorted(snapshot.nodes, key=lambda node: str(node.id))[: min(max_nodes, 20)]
    selected_ids = {node.id for node in selected}
    assertions = sorted(
        (
            item
            for item in snapshot.assertions
            if item.is_active and item.subject_id in selected_ids and item.object_id in selected_ids
        ),
        key=lambda item: str(item.id),
    )[: max_nodes * 4]
    return (
        [node.model_dump(mode="json") for node in selected],
        [item.model_dump(mode="json") for item in assertions],
    )


__all__ = [
    "ConflictCandidate",
    "EquivalentCandidate",
    "GraphComparisonProposal",
    "GraphComparisonProvider",
    "GraphProposalValidationError",
    "GraphProposalValidator",
    "MergeCandidate",
    "ModelGraphComparator",
    "ProposedMerge",
    "RelationCandidate",
    "TemporalReplacement",
    "UnresolvedGraphItem",
]
