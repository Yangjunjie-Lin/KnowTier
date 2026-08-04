"""Versioned graph and first-class relation assertion models."""

from __future__ import annotations

from datetime import datetime
from typing import Self
from uuid import UUID, uuid4, uuid5

from pydantic import Field, model_validator

from cognigraph.domain.base import DomainModel, JsonObject, utc_now
from cognigraph.domain.enums import (
    EpistemicStatus,
    GraphRevisionStatus,
    NodeType,
    RelationTypeKey,
)


class RelationType(DomainModel):
    id: UUID = Field(default_factory=uuid4)
    name: RelationTypeKey
    description: str = Field(min_length=1)
    inverse_name: RelationTypeKey | None = None
    domain_types: list[NodeType] = Field(min_length=1)
    range_types: list[NodeType] = Field(min_length=1)
    symmetric: bool = False
    transitive: bool = False
    temporal: bool = False
    examples: list[str] = Field(default_factory=list)
    validation_rules: JsonObject = Field(default_factory=dict)

    @model_validator(mode="after")
    def symmetric_inverse_is_coherent(self) -> Self:
        if self.symmetric and self.inverse_name not in {None, self.name}:
            raise ValueError("a symmetric relation cannot have a distinct inverse")
        return self


_ONTOLOGY_NAMESPACE = UUID("4f6265e8-f135-4adb-a202-b0acba0d8c31")


def core_relation_types(workspace_id: UUID | None = None) -> list[RelationType]:
    """Return the stable, queryable descriptors for every supported predicate.

    The descriptors are application-owned ontology data.  Model output may select a
    predicate, but it cannot redefine that predicate's temporal or endpoint rules.
    """

    namespace = (
        uuid5(_ONTOLOGY_NAMESPACE, f"workspace:{workspace_id}")
        if workspace_id is not None
        else _ONTOLOGY_NAMESPACE
    )
    knowledge = [NodeType.KNOWLEDGE_POINT]
    teachable = [
        NodeType.KNOWLEDGE_POINT,
        NodeType.THEORY,
        NodeType.DEFINITION,
        NodeType.METHOD,
    ]
    content = [
        *teachable,
        NodeType.EXAMPLE,
        NodeType.COUNTEREXAMPLE,
        NodeType.MISCONCEPTION,
        NodeType.QUESTION,
        NodeType.LEARNING_STAGE,
        NodeType.DOMAIN,
        NodeType.CONSTRAINT,
    ]

    def descriptor(
        name: RelationTypeKey,
        description: str,
        domain_types: list[NodeType],
        range_types: list[NodeType],
        *,
        inverse_name: RelationTypeKey | None = None,
        symmetric: bool = False,
        transitive: bool = False,
        temporal: bool = False,
        examples: list[str] | None = None,
    ) -> RelationType:
        return RelationType(
            id=uuid5(namespace, f"relation-type:{name.value}"),
            name=name,
            description=description,
            inverse_name=inverse_name,
            domain_types=list(dict.fromkeys(domain_types)),
            range_types=list(dict.fromkeys(range_types)),
            symmetric=symmetric,
            transitive=transitive,
            temporal=temporal,
            examples=examples or [],
            validation_rules={
                "model_may_override_temporal": False,
                "requires_distinct_endpoints": True,
            },
        )

    descriptors = [
        descriptor(
            RelationTypeKey.IS_A,
            "The subject is a specialization or instance of the object.",
            content,
            content,
            transitive=True,
        ),
        descriptor(
            RelationTypeKey.PART_OF,
            "The subject forms a constituent part of the object.",
            content,
            content,
            transitive=True,
        ),
        descriptor(
            RelationTypeKey.REQUIRES,
            "The subject knowledge point requires the object knowledge point first.",
            knowledge,
            knowledge,
            examples=["Bayesian updating REQUIRES conditional probability."],
        ),
        descriptor(
            RelationTypeKey.ENABLES,
            "Mastering the subject enables learning or using the object.",
            knowledge,
            knowledge,
        ),
        descriptor(
            RelationTypeKey.EXPLAINS,
            "The subject provides an explanation of the object.",
            teachable,
            teachable,
        ),
        descriptor(
            RelationTypeKey.CONTRASTS_WITH,
            "The endpoints are usefully contrasted.",
            content,
            content,
            inverse_name=RelationTypeKey.CONTRASTS_WITH,
            symmetric=True,
        ),
        descriptor(
            RelationTypeKey.SIMILAR_TO,
            "The endpoints are meaningfully similar without being identical.",
            content,
            content,
            inverse_name=RelationTypeKey.SIMILAR_TO,
            symmetric=True,
        ),
        descriptor(
            RelationTypeKey.APPLIES_TO,
            "The subject can be applied to the object scope or problem.",
            teachable,
            content,
        ),
        descriptor(
            RelationTypeKey.FAILS_WHEN,
            "The subject fails under the condition represented by the object.",
            teachable,
            [NodeType.CONSTRAINT, NodeType.COUNTEREXAMPLE, NodeType.KNOWLEDGE_POINT],
        ),
        descriptor(
            RelationTypeKey.SUPPORTED_BY,
            "The subject claim is supported by the object source evidence.",
            [*content, NodeType.RELATION_ASSERTION],
            [NodeType.SOURCE_SPAN, NodeType.SOURCE_DOCUMENT],
        ),
        descriptor(
            RelationTypeKey.DERIVED_FROM,
            "The subject was derived from the object.",
            content,
            [*content, NodeType.SOURCE_SPAN, NodeType.SOURCE_DOCUMENT],
        ),
        descriptor(
            RelationTypeKey.EXAMPLE_OF,
            "The subject is a positive example of the object.",
            [NodeType.EXAMPLE],
            teachable,
        ),
        descriptor(
            RelationTypeKey.COUNTEREXAMPLE_OF,
            "The subject is a counterexample delimiting the object.",
            [NodeType.COUNTEREXAMPLE],
            teachable,
        ),
        descriptor(
            RelationTypeKey.MISCONCEPTION_ABOUT,
            "The subject records a misconception about the object.",
            [NodeType.MISCONCEPTION],
            knowledge,
        ),
        descriptor(
            RelationTypeKey.ASSESSES,
            "The subject question assesses the object knowledge point or stage.",
            [NodeType.QUESTION],
            [NodeType.KNOWLEDGE_POINT, NodeType.LEARNING_STAGE],
        ),
        descriptor(
            RelationTypeKey.TEACHES,
            "The subject learning stage teaches the object knowledge point.",
            [NodeType.LEARNING_STAGE],
            knowledge,
        ),
        descriptor(
            RelationTypeKey.MASTERED_BY,
            "The subject knowledge point is mastered by the object learner.",
            knowledge,
            [NodeType.LEARNER],
        ),
        descriptor(
            RelationTypeKey.SUPERSEDES,
            "The subject assertion replaces the object assertion without deleting history.",
            [NodeType.RELATION_ASSERTION],
            [NodeType.RELATION_ASSERTION],
            temporal=True,
        ),
        descriptor(
            RelationTypeKey.CONFLICTS_WITH,
            "The endpoints are retained as an unresolved explicit conflict.",
            [NodeType.RELATION_ASSERTION, *content],
            [NodeType.RELATION_ASSERTION, *content],
            inverse_name=RelationTypeKey.CONFLICTS_WITH,
            symmetric=True,
        ),
    ]
    return descriptors


class RelationAssertion(DomainModel):
    """A traceable semantic edge represented as a first-class graph node."""

    id: UUID = Field(default_factory=uuid4)
    workspace_id: UUID
    subject_id: UUID
    relation_type_id: UUID | None = None
    predicate_key: RelationTypeKey
    object_id: UUID
    natural_language_description: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    epistemic_status: EpistemicStatus = EpistemicStatus.UNVERIFIED
    valid_from: datetime = Field(default_factory=utc_now)
    valid_to: datetime | None = None
    created_at: datetime = Field(default_factory=utc_now)
    superseded_at: datetime | None = None
    created_by: str = Field(min_length=1)
    source_span_ids: list[UUID] = Field(default_factory=list)
    model_run_id: UUID | None = None
    graph_revision_id: UUID
    supersedes_assertion_id: UUID | None = None

    @property
    def is_active(self) -> bool:
        return self.valid_to is None and self.superseded_at is None

    @model_validator(mode="after")
    def valid_trace_and_lifetime(self) -> Self:
        if self.subject_id == self.object_id:
            raise ValueError("relation assertion subject and object must differ")
        if self.valid_to is not None and self.valid_to < self.valid_from:
            raise ValueError("valid_to cannot precede valid_from")
        if self.superseded_at is not None:
            if self.valid_to is None:
                raise ValueError("a superseded assertion must have valid_to")
            if self.superseded_at < self.valid_from:
                raise ValueError("superseded_at cannot precede valid_from")
        if self.epistemic_status is EpistemicStatus.CONFIRMED and not self.source_span_ids:
            raise ValueError("confirmed assertions require at least one source span")
        if self.supersedes_assertion_id == self.id:
            raise ValueError("an assertion cannot supersede itself")
        return self


class GraphRevision(DomainModel):
    id: UUID = Field(default_factory=uuid4)
    workspace_id: UUID
    sequence: int = Field(ge=1)
    base_revision_id: UUID | None = None
    delta_id: UUID
    status: GraphRevisionStatus = GraphRevisionStatus.PENDING
    nodes_added: int = Field(default=0, ge=0)
    nodes_updated: int = Field(default=0, ge=0)
    assertions_added: int = Field(default=0, ge=0)
    assertions_superseded: int = Field(default=0, ge=0)
    content_hash: str = Field(min_length=64, max_length=64)
    created_at: datetime = Field(default_factory=utc_now)
    applied_at: datetime | None = None


class OntologyManifest(DomainModel):
    entity_types: list[str] = Field(default_factory=list)
    relation_types: list[str] = Field(default_factory=list)


class GraphCluster(DomainModel):
    name: str
    node_count: int = Field(ge=0)


class GraphManifest(DomainModel):
    workspace_id: UUID
    revision_id: UUID | None
    ontology: OntologyManifest = Field(default_factory=OntologyManifest)
    top_level_domains: list[str] = Field(default_factory=list)
    theories: list[str] = Field(default_factory=list)
    knowledge_point_count: int = Field(ge=0)
    assertion_count: int = Field(ge=0)
    source_count: int = Field(ge=0)
    major_clusters: list[GraphCluster] = Field(default_factory=list)
    updated_at: datetime = Field(default_factory=utc_now)
