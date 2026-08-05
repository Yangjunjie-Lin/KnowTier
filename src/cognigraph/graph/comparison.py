"""Orchestration for the optional graph-model comparison step.

This module intentionally stops at a validated proposal.  Canonical IDs,
supersession, conflict handling, and persistence remain deterministic code in
``BlueprintGraphDeltaBuilder`` and ``GraphDeltaRepository``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from cognigraph.domain.enums import RelationTypeKey
from cognigraph.graph.applier import GraphSnapshot
from cognigraph.graph.proposals import (
    GraphComparisonProposal,
    GraphProposalValidationError,
    GraphProposalValidator,
    ModelGraphComparator,
)
from cognigraph.llm.schemas import ModelCallContext

_UNTRUSTED_OPERATION_WORDS = frozenset(
    {
        "cypher",
        "match (",
        "merge (",
        "delete ",
        "drop ",
        "insert ",
        "update ",
        "sql",
        "write",
    }
)


@dataclass(frozen=True, slots=True)
class GraphComparisonResult:
    proposal: GraphComparisonProposal
    model_run_id: UUID | None
    fallback_used: bool = False
    rejected_items: int = 0
    context_truncated: bool = False


class GraphProposalCanonicalizer:
    """Apply deterministic safety checks to a read-only model proposal."""

    def __init__(self, validator: GraphProposalValidator | None = None) -> None:
        self.validator = validator or GraphProposalValidator()

    def canonicalize(
        self,
        proposal: GraphComparisonProposal,
        *,
        workspace_id: UUID,
        snapshot: GraphSnapshot,
    ) -> GraphComparisonProposal:
        self.validator.validate(proposal, workspace_id=workspace_id, snapshot=snapshot)
        for unresolved in proposal.unresolved_items:
            self._reject_operation_text(unresolved.description)
            if unresolved.reason:
                self._reject_operation_text(unresolved.reason)
        for equivalent in proposal.equivalent_candidates:
            self._reject_operation_text(equivalent.reason)
        for merge in proposal.merge_candidates:
            self._reject_operation_text(merge.reason)
        for relation in proposal.relation_candidates:
            self._reject_operation_text(relation.description)
            predicate = str(relation.predicate)
            if predicate not in {value.value for value in RelationTypeKey}:
                raise GraphProposalValidationError(f"unsupported relation predicate: {predicate}")
        return proposal

    @staticmethod
    def _reject_operation_text(value: str) -> None:
        lowered = value.casefold()
        if any(token in lowered for token in _UNTRUSTED_OPERATION_WORDS):
            raise GraphProposalValidationError("graph proposal contains an operation instruction")


class GraphComparisonService:
    """Feature-gated graph-model call with deterministic fallback."""

    def __init__(
        self,
        *,
        gateway: object | None = None,
        enabled: bool = False,
        comparator: ModelGraphComparator | None = None,
        canonicalizer: GraphProposalCanonicalizer | None = None,
    ) -> None:
        self.enabled = enabled
        self.comparator = comparator or (ModelGraphComparator(gateway) if gateway else None)
        self.canonicalizer = canonicalizer or GraphProposalCanonicalizer()

    async def compare(
        self,
        *,
        workspace_id: UUID,
        candidate: Any,
        snapshot: GraphSnapshot,
        context: ModelCallContext,
    ) -> GraphComparisonResult:
        empty = GraphComparisonProposal()
        if not self.enabled or self.comparator is None:
            return GraphComparisonResult(proposal=empty, model_run_id=None, fallback_used=True)
        try:
            proposal, call = await self.comparator.compare(
                workspace_id=workspace_id,
                candidate=candidate,
                snapshot=snapshot,
                context=context,
            )
            try:
                canonical = self.canonicalizer.canonicalize(
                    proposal,
                    workspace_id=workspace_id,
                    snapshot=snapshot,
                )
            except GraphProposalValidationError:
                return GraphComparisonResult(
                    proposal=empty,
                    model_run_id=call.model_run_id,
                    fallback_used=True,
                    rejected_items=1,
                    context_truncated=call.context_truncated,
                )
            return GraphComparisonResult(
                proposal=canonical,
                model_run_id=call.model_run_id,
                context_truncated=call.context_truncated,
            )
        except Exception:
            # A graph advisor is optional.  A malformed/unsupported response
            # must leave the deterministic extraction path operational.
            return GraphComparisonResult(proposal=empty, model_run_id=None, fallback_used=True)


__all__ = [
    "GraphComparisonResult",
    "GraphComparisonService",
    "GraphProposalCanonicalizer",
]
