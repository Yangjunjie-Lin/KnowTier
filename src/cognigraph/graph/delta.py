"""Pydantic contracts for auditable, append-only graph changes."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Self
from uuid import UUID, uuid4

from pydantic import Field, field_validator, model_validator

from cognigraph.domain.base import DomainModel, JsonObject, utc_now
from cognigraph.domain.enums import ConflictType, EpistemicStatus, NodeType, RelationTypeKey
from cognigraph.domain.graph import RelationAssertion
from cognigraph.domain.learner import LearnerGraphDelta  # noqa: F401

_FORBIDDEN_PATCH_KEYS = frozenset(
    {
        "delete",
        "deleted",
        "deleted_at",
        "hard_delete",
        "id",
        "workspace_id",
        "graph_revision_id",
    }
)


class NodeCreate(DomainModel):
    id: UUID = Field(default_factory=uuid4)
    node_type: NodeType
    properties: JsonObject
    epistemic_status: EpistemicStatus = EpistemicStatus.UNVERIFIED
    source_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    source_span_ids: list[UUID] = Field(default_factory=list)
    created_by: str = Field(default="system", min_length=1)
    model_run_id: UUID | None = None

    @model_validator(mode="after")
    def confirmed_nodes_have_evidence(self) -> Self:
        evidence_carriers = {
            NodeType.SOURCE_DOCUMENT,
            NodeType.SOURCE_SPAN,
            NodeType.ENTITY_TYPE,
            NodeType.RELATION_TYPE,
            NodeType.CONSTRAINT,
            NodeType.EPISTEMIC_STATUS,
        }
        if (
            self.epistemic_status is EpistemicStatus.CONFIRMED
            and self.node_type not in evidence_carriers
            and not self.source_span_ids
        ):
            raise ValueError("confirmed nodes require at least one source span")
        if len(self.source_span_ids) != len(set(self.source_span_ids)):
            raise ValueError("source_span_ids must be unique")
        return self


class NodePatch(DomainModel):
    node_id: UUID
    set_properties: JsonObject = Field(min_length=1)
    source_span_ids: list[UUID] = Field(default_factory=list)
    expected_revision_id: UUID | None = None

    @field_validator("set_properties")
    @classmethod
    def cannot_express_hard_delete(cls, value: JsonObject) -> JsonObject:
        illegal = _forbidden_keys(value)
        if illegal:
            names = ", ".join(sorted(illegal))
            raise ValueError(f"immutable or deletion properties cannot be patched: {names}")
        return value


def _forbidden_keys(value: JsonObject) -> set[str]:
    illegal: set[str] = set()
    for key, item in value.items():
        normalized = key.casefold()
        if normalized in _FORBIDDEN_PATCH_KEYS:
            illegal.add(normalized)
        if isinstance(item, dict):
            illegal.update(_forbidden_keys(item))
    return illegal


class AssertionCreate(DomainModel):
    id: UUID = Field(default_factory=uuid4)
    subject_id: UUID
    relation_type_id: UUID | None = None
    predicate_key: RelationTypeKey
    object_id: UUID
    natural_language_description: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    epistemic_status: EpistemicStatus = EpistemicStatus.UNVERIFIED
    valid_from: datetime = Field(default_factory=utc_now)
    created_at: datetime = Field(default_factory=utc_now)
    source_span_ids: list[UUID] = Field(default_factory=list)
    created_by: str = Field(default="system", min_length=1)
    model_run_id: UUID | None = None
    metadata: JsonObject = Field(default_factory=dict)

    @model_validator(mode="after")
    def valid_assertion_candidate(self) -> Self:
        if self.subject_id == self.object_id:
            raise ValueError("relation assertion subject and object must differ")
        if self.epistemic_status is EpistemicStatus.CONFIRMED and not self.source_span_ids:
            raise ValueError("confirmed assertions require at least one source span")
        if len(self.source_span_ids) != len(set(self.source_span_ids)):
            raise ValueError("source_span_ids must be unique")
        return self

    def materialize(self, workspace_id: UUID, graph_revision_id: UUID) -> RelationAssertion:
        """Bind a validated candidate to its workspace and committed revision."""

        return RelationAssertion(
            id=self.id,
            workspace_id=workspace_id,
            subject_id=self.subject_id,
            relation_type_id=self.relation_type_id,
            predicate_key=self.predicate_key,
            object_id=self.object_id,
            natural_language_description=self.natural_language_description,
            confidence=self.confidence,
            epistemic_status=self.epistemic_status,
            valid_from=self.valid_from,
            created_at=self.created_at,
            created_by=self.created_by,
            source_span_ids=self.source_span_ids,
            model_run_id=self.model_run_id,
            graph_revision_id=graph_revision_id,
        )


class AssertionSupersede(DomainModel):
    assertion_id: UUID
    replacement_assertion_id: UUID
    superseded_at: datetime = Field(default_factory=utc_now)
    reason: str = Field(min_length=1)

    @model_validator(mode="after")
    def replacement_is_distinct(self) -> Self:
        if self.assertion_id == self.replacement_assertion_id:
            raise ValueError("an assertion cannot supersede itself")
        return self


class ProvenanceLink(DomainModel):
    entity_id: UUID
    source_span_id: UUID
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    extraction_method: str = Field(default="model", min_length=1)


class MergeCandidate(DomainModel):
    source_node_id: UUID
    target_node_id: UUID
    similarity: float = Field(ge=0.0, le=1.0)
    reason: str = Field(min_length=1)
    requires_review: bool = True

    @model_validator(mode="after")
    def distinct_nodes(self) -> Self:
        if self.source_node_id == self.target_node_id:
            raise ValueError("merge candidates must refer to distinct nodes")
        return self


class ConflictCandidate(DomainModel):
    id: UUID = Field(default_factory=uuid4)
    conflict_type: ConflictType
    assertion_ids: list[UUID] = Field(min_length=2)
    description: str = Field(min_length=1)
    requires_review: bool = True

    @model_validator(mode="after")
    def unique_assertions(self) -> Self:
        if len(set(self.assertion_ids)) != len(self.assertion_ids):
            raise ValueError("conflict assertion_ids must be unique")
        return self


class GraphDelta(DomainModel):
    """A complete, idempotent proposal for one graph revision."""

    id: UUID = Field(default_factory=uuid4)
    workspace_id: UUID
    base_revision_id: UUID | None = None
    add_nodes: list[NodeCreate] = Field(default_factory=list)
    update_nodes: list[NodePatch] = Field(default_factory=list)
    add_assertions: list[AssertionCreate] = Field(default_factory=list)
    supersede_assertions: list[AssertionSupersede] = Field(default_factory=list)
    add_provenance_links: list[ProvenanceLink] = Field(default_factory=list)
    merge_candidates: list[MergeCandidate] = Field(default_factory=list)
    conflicts: list[ConflictCandidate] = Field(default_factory=list)
    generated_by_model_run_id: UUID | None = None
    created_at: datetime = Field(default_factory=utc_now)

    @model_validator(mode="after")
    def deterministic_cross_reference_validation(self) -> Self:
        node_ids = [node.id for node in self.add_nodes]
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("add_nodes contains duplicate ids")
        patch_ids = [patch.node_id for patch in self.update_nodes]
        if len(patch_ids) != len(set(patch_ids)):
            raise ValueError("update_nodes contains duplicate node ids")
        if set(node_ids).intersection(patch_ids):
            raise ValueError("a node cannot be added and patched in the same delta")

        assertion_ids = [assertion.id for assertion in self.add_assertions]
        if len(assertion_ids) != len(set(assertion_ids)):
            raise ValueError("add_assertions contains duplicate ids")
        assertion_id_set = set(assertion_ids)
        superseded_ids = [item.assertion_id for item in self.supersede_assertions]
        if len(superseded_ids) != len(set(superseded_ids)):
            raise ValueError("an assertion can be superseded only once per delta")
        for item in self.supersede_assertions:
            if item.replacement_assertion_id not in assertion_id_set:
                raise ValueError("replacement_assertion_id must be created in the same delta")

        provenance_pairs = [
            (link.entity_id, link.source_span_id) for link in self.add_provenance_links
        ]
        if len(provenance_pairs) != len(set(provenance_pairs)):
            raise ValueError("duplicate provenance link")

        signatures = [
            (item.subject_id, item.predicate_key, item.object_id) for item in self.add_assertions
        ]
        if len(signatures) != len(set(signatures)):
            raise ValueError("duplicate subject-predicate-object assertions in one delta")
        return self

    def canonical_json(self) -> str:
        """Serialize the delta deterministically for audit hashes and idempotency."""

        payload = self.model_dump(mode="json", exclude={"created_at"})
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

    def content_hash(self) -> str:
        return hashlib.sha256(self.canonical_json().encode("utf-8")).hexdigest()

    @property
    def is_empty(self) -> bool:
        return not any(
            (
                self.add_nodes,
                self.update_nodes,
                self.add_assertions,
                self.supersede_assertions,
                self.add_provenance_links,
                self.merge_candidates,
                self.conflicts,
            )
        )
