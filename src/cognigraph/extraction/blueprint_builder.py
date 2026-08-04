from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol
from uuid import UUID, uuid5

from cognigraph.domain.documents import Document, SourceSpan
from cognigraph.domain.enums import (
    ConflictType,
    EpistemicStatus,
    NodeType,
    RelationTypeKey,
)
from cognigraph.extraction.canonicalizer import (
    CanonicalizationResult,
    EntityCanonicalizer,
    canonical_text,
)
from cognigraph.extraction.conflict_detector import ConflictDetector
from cognigraph.extraction.schemas import KnowledgeBlueprint
from cognigraph.graph.applier import GraphSnapshot
from cognigraph.graph.delta import (
    AssertionCreate,
    AssertionSupersede,
    ConflictCandidate,
    GraphDelta,
    NodeCreate,
    ProvenanceLink,
)


class _PointContentCandidate(Protocol):
    candidate_key: str
    knowledge_point_candidate_id: str


class BlueprintGraphDeltaBuilder:
    """Convert model candidates into a deterministic, reviewable GraphDelta."""

    def __init__(self) -> None:
        self.canonicalizer = EntityCanonicalizer()
        self.conflict_detector = ConflictDetector()

    def build(
        self,
        *,
        workspace_id: UUID,
        document: Document,
        source_spans: list[SourceSpan],
        blueprint: KnowledgeBlueprint,
        snapshot: GraphSnapshot,
        model_run_id: UUID | None = None,
    ) -> GraphDelta:
        if document.workspace_id != workspace_id or snapshot.workspace_id != workspace_id:
            raise ValueError("document and snapshot must belong to the target workspace")
        known_span_ids = {span.id for span in source_spans}
        self._validate_source_references(blueprint, known_span_ids)
        canonical = self.canonicalizer.canonicalize(
            workspace_id=workspace_id,
            blueprint=blueprint,
            snapshot=snapshot,
        )
        nodes = self._ontology_nodes(snapshot)
        nodes.extend(self._source_nodes(document, source_spans, snapshot))
        nodes.extend(
            self._candidate_nodes(
                blueprint,
                canonical,
                snapshot,
                model_run_id,
            )
        )
        provenance = self._node_provenance(blueprint, canonical)
        assertions = self._candidate_assertions(
            blueprint,
            canonical,
            snapshot,
            model_run_id,
        )
        assertions.extend(
            self._implicit_assertions(
                blueprint,
                canonical,
                snapshot,
                model_run_id,
            )
        )
        assertions = self._unique_assertions(assertions)

        add_assertions: list[AssertionCreate] = []
        supersede: list[AssertionSupersede] = []
        conflicts: list[ConflictCandidate] = []
        relation_temporal = {
            descriptor.name: descriptor.temporal for descriptor in snapshot.relation_types
        }
        for candidate in assertions:
            temporal = relation_temporal.get(candidate.predicate_key, False)
            detected = self.conflict_detector.detect(
                candidate,
                snapshot.assertions,
                temporal=temporal,
            )
            duplicate = next(
                (
                    item
                    for item in detected
                    if item.conflict_type is ConflictType.DUPLICATE_ASSERTION
                ),
                None,
            )
            if duplicate is not None:
                provenance.extend(
                    ProvenanceLink(
                        entity_id=duplicate.existing_assertion_id,
                        source_span_id=source_id,
                        confidence=candidate.confidence,
                        extraction_method="knowledge_blueprint",
                    )
                    for source_id in candidate.source_span_ids
                )
                continue
            add_assertions.append(candidate)
            for item in detected:
                if item.should_supersede:
                    supersede.append(
                        AssertionSupersede(
                            assertion_id=item.existing_assertion_id,
                            replacement_assertion_id=item.candidate_assertion_id,
                            reason=item.description,
                        )
                    )
                else:
                    conflicts.append(
                        ConflictCandidate(
                            conflict_type=item.conflict_type,
                            assertion_ids=[
                                item.existing_assertion_id,
                                item.candidate_assertion_id,
                            ],
                            description=item.description,
                        )
                    )
        return GraphDelta(
            id=uuid5(document.id, f"graph-delta:{document.content_hash}"),
            workspace_id=workspace_id,
            base_revision_id=snapshot.revision_id,
            add_nodes=self._unique_new_nodes(nodes, snapshot),
            add_assertions=add_assertions,
            supersede_assertions=supersede,
            add_provenance_links=self._unique_provenance(provenance),
            conflicts=conflicts,
            generated_by_model_run_id=model_run_id,
        )

    @staticmethod
    def _ontology_nodes(snapshot: GraphSnapshot) -> list[NodeCreate]:
        existing = snapshot.node_map()
        nodes: list[NodeCreate] = []
        for entity_type in NodeType:
            entity_type_id = uuid5(
                snapshot.workspace_id,
                f"ontology:entity-type:{entity_type.value}",
            )
            if entity_type_id not in existing:
                nodes.append(
                    NodeCreate(
                        id=entity_type_id,
                        node_type=NodeType.ENTITY_TYPE,
                        properties={
                            "name": entity_type.value,
                            "description": f"Cognigraph entity type {entity_type.value}.",
                        },
                        epistemic_status=EpistemicStatus.CONFIRMED,
                        source_confidence=1.0,
                        created_by="core_ontology",
                    )
                )
        for status in EpistemicStatus:
            status_id = uuid5(
                snapshot.workspace_id,
                f"ontology:epistemic-status:{status.value}",
            )
            if status_id not in existing:
                nodes.append(
                    NodeCreate(
                        id=status_id,
                        node_type=NodeType.EPISTEMIC_STATUS,
                        properties={
                            "name": status.value,
                            "description": f"Epistemic status {status.value}.",
                        },
                        epistemic_status=EpistemicStatus.CONFIRMED,
                        source_confidence=1.0,
                        created_by="core_ontology",
                    )
                )
        constraint_id = uuid5(
            snapshot.workspace_id,
            "ontology:constraint:traceable-confirmed-knowledge",
        )
        if constraint_id not in existing:
            nodes.append(
                NodeCreate(
                    id=constraint_id,
                    node_type=NodeType.CONSTRAINT,
                    properties={
                        "name": "traceable-confirmed-knowledge",
                        "description": (
                            "Confirmed knowledge and semantic assertions require source evidence."
                        ),
                        "validation_rule": "CONFIRMED_REQUIRES_SOURCE",
                    },
                    epistemic_status=EpistemicStatus.CONFIRMED,
                    source_confidence=1.0,
                    created_by="core_ontology",
                )
            )
        for relation_type in snapshot.relation_types:
            if relation_type.id in existing:
                continue
            nodes.append(
                NodeCreate(
                    id=relation_type.id,
                    node_type=NodeType.RELATION_TYPE,
                    properties={
                        "name": relation_type.name.value,
                        "description": relation_type.description,
                        "inverse_name": (
                            relation_type.inverse_name.value
                            if relation_type.inverse_name is not None
                            else None
                        ),
                        "domain_types": [item.value for item in relation_type.domain_types],
                        "range_types": [item.value for item in relation_type.range_types],
                        "symmetric": relation_type.symmetric,
                        "transitive": relation_type.transitive,
                        "temporal": relation_type.temporal,
                        "examples": relation_type.examples,
                        "validation_rules": relation_type.validation_rules,
                    },
                    epistemic_status=EpistemicStatus.CONFIRMED,
                    source_confidence=1.0,
                    created_by="core_ontology",
                )
            )
        return nodes

    @staticmethod
    def _source_nodes(
        document: Document,
        source_spans: list[SourceSpan],
        snapshot: GraphSnapshot,
    ) -> list[NodeCreate]:
        existing = snapshot.node_map()
        nodes: list[NodeCreate] = []
        if document.id not in existing:
            nodes.append(
                NodeCreate(
                    id=document.id,
                    node_type=NodeType.SOURCE_DOCUMENT,
                    properties={
                        "original_filename": document.original_filename,
                        "mime_type": document.mime_type,
                        "content_hash": document.content_hash,
                        "language": document.language,
                        "parser_name": document.parser_name,
                        "parser_version": document.parser_version,
                        "page_count": document.page_count,
                    },
                    epistemic_status=EpistemicStatus.CONFIRMED,
                    source_confidence=1.0,
                    created_by="ingestion",
                )
            )
        for span in source_spans:
            if span.id in existing:
                continue
            nodes.append(
                NodeCreate(
                    id=span.id,
                    node_type=NodeType.SOURCE_SPAN,
                    properties=span.model_dump(mode="json"),
                    epistemic_status=EpistemicStatus.CONFIRMED,
                    source_confidence=1.0,
                    created_by="ingestion",
                )
            )
        return nodes

    def _candidate_nodes(
        self,
        blueprint: KnowledgeBlueprint,
        canonical: CanonicalizationResult,
        snapshot: GraphSnapshot,
        model_run_id: UUID | None,
    ) -> list[NodeCreate]:
        nodes: list[NodeCreate] = []
        if blueprint.domain:
            domain_source_ids = [
                source_id for theory in blueprint.theories for source_id in theory.source_span_ids
            ] + [
                source_id
                for point in blueprint.knowledge_points
                for source_id in point.source_span_ids
            ]
            domain_sources = list(dict.fromkeys(domain_source_ids))
            if domain_sources:
                domain_confidences = [theory.confidence for theory in blueprint.theories] + [
                    point.confidence for point in blueprint.knowledge_points
                ]
                nodes.append(
                    self._node(
                        self._domain_id(snapshot.workspace_id, blueprint.domain),
                        NodeType.DOMAIN,
                        {
                            "name": blueprint.domain,
                            "description": f"Source-grounded domain: {blueprint.domain}.",
                        },
                        domain_sources,
                        confidence=max(domain_confidences, default=0.0),
                        model_run_id=model_run_id,
                    )
                )
        for theory in blueprint.theories:
            if theory.candidate_key not in canonical.matched_existing:
                nodes.append(
                    self._node(
                        canonical.candidate_ids[theory.candidate_key],
                        NodeType.THEORY,
                        {"name": theory.name, "description": theory.description},
                        theory.source_span_ids,
                        confidence=theory.confidence,
                        model_run_id=model_run_id,
                    )
                )

        examples_by_point = self._content_ids_by_point(
            blueprint.examples,
            canonical,
        )
        counterexamples_by_point = self._content_ids_by_point(
            blueprint.counterexamples,
            canonical,
        )
        misconceptions_by_point = self._content_ids_by_point(
            blueprint.misconceptions,
            canonical,
        )
        questions_by_stage: dict[tuple[str, int], list[UUID]] = {}
        for question in blueprint.questions:
            questions_by_stage.setdefault(
                (
                    question.knowledge_point_candidate_id,
                    int(question.cognitive_level),
                ),
                [],
            ).append(canonical.candidate_ids[question.candidate_key])

        for point in blueprint.knowledge_points:
            point_id = canonical.candidate_ids[point.candidate_key]
            if point.candidate_key not in canonical.matched_existing:
                nodes.append(
                    self._node(
                        point_id,
                        NodeType.KNOWLEDGE_POINT,
                        {
                            "canonical_name": point.canonical_name,
                            "display_name": point.canonical_name,
                            "aliases": [],
                            "summary": point.plain_definition,
                            "plain_language_definition": point.plain_definition,
                            "formal_definition": point.formal_definition,
                            "importance": point.importance,
                            "difficulty": point.difficulty,
                            "scope": blueprint.domain or "source material",
                            "domain": blueprint.domain,
                            "must_cover": point.must_cover,
                            "common_confusions": point.common_confusions,
                            "applicability": point.applicability,
                            "limitations": point.limitations,
                            "language": "zh-CN",
                        },
                        point.source_span_ids,
                        confidence=point.confidence,
                        model_run_id=model_run_id,
                    )
                )

            default_example_ids = examples_by_point.get(point.candidate_key, [])
            default_counterexample_ids = counterexamples_by_point.get(point.candidate_key, [])
            default_misconception_ids = misconceptions_by_point.get(point.candidate_key, [])
            for stage in point.six_level_plan:
                level = int(stage.cognitive_level)
                stage_id = uuid5(point_id, f"learning-stage:{level}")
                question_ids = questions_by_stage.get((point.candidate_key, level), [])
                if not question_ids:
                    diagnostic_id = uuid5(stage_id, "diagnostic-question")
                    question_ids = [diagnostic_id]
                    nodes.append(
                        self._node(
                            diagnostic_id,
                            NodeType.QUESTION,
                            {
                                "knowledge_point_id": str(point_id),
                                "cognitive_level": level,
                                "question": stage.diagnostic_question,
                                "success_criteria": stage.mastery_criteria,
                                "generated_from_learning_stage_id": str(stage_id),
                            },
                            point.source_span_ids,
                            confidence=point.confidence,
                            model_run_id=model_run_id,
                        )
                    )

                required_keys = list(
                    dict.fromkeys([*point.prerequisites, *stage.required_prerequisites])
                )
                example_ids = self._stage_content_ids(
                    stage.example_candidate_ids,
                    default_example_ids,
                    canonical,
                )
                counterexample_ids = self._stage_content_ids(
                    stage.counterexample_candidate_ids,
                    default_counterexample_ids,
                    canonical,
                )
                misconception_ids = self._stage_content_ids(
                    stage.misconception_candidate_ids,
                    default_misconception_ids,
                    canonical,
                )
                nodes.append(
                    self._node(
                        stage_id,
                        NodeType.LEARNING_STAGE,
                        {
                            "knowledge_point_id": str(point_id),
                            "cognitive_level": level,
                            "learning_objective": stage.learning_objective,
                            "teaching_strategy": stage.teaching_strategy,
                            "required_prerequisites": [
                                str(canonical.candidate_ids[key]) for key in required_keys
                            ],
                            "must_cover_items": stage.must_cover,
                            "example_ids": [str(item) for item in example_ids],
                            "counterexample_ids": [str(item) for item in counterexample_ids],
                            "misconception_ids": [str(item) for item in misconception_ids],
                            "diagnostic_question_ids": [str(item) for item in question_ids],
                            "mastery_criteria": stage.mastery_criteria,
                            "promotion_requirements": stage.promotion_requirements,
                            "remediation_policy": stage.remediation_policy,
                        },
                        point.source_span_ids,
                        confidence=point.confidence,
                        model_run_id=model_run_id,
                    )
                )
        for example in blueprint.examples:
            if example.candidate_key not in canonical.matched_existing:
                nodes.append(
                    self._node(
                        canonical.candidate_ids[example.candidate_key],
                        NodeType.EXAMPLE,
                        {"content": example.content},
                        example.source_span_ids,
                        confidence=1.0,
                        model_run_id=model_run_id,
                    )
                )
        for counterexample in blueprint.counterexamples:
            if counterexample.candidate_key not in canonical.matched_existing:
                nodes.append(
                    self._node(
                        canonical.candidate_ids[counterexample.candidate_key],
                        NodeType.COUNTEREXAMPLE,
                        {
                            "content": counterexample.content,
                            "boundary_explained": counterexample.boundary_explained,
                        },
                        counterexample.source_span_ids,
                        confidence=1.0,
                        model_run_id=model_run_id,
                    )
                )
        for misconception in blueprint.misconceptions:
            if misconception.candidate_key not in canonical.matched_existing:
                nodes.append(
                    self._node(
                        canonical.candidate_ids[misconception.candidate_key],
                        NodeType.MISCONCEPTION,
                        {
                            "statement": misconception.statement,
                            "correction": misconception.correction,
                        },
                        misconception.source_span_ids,
                        confidence=1.0,
                        model_run_id=model_run_id,
                    )
                )
        for question in blueprint.questions:
            if question.candidate_key not in canonical.matched_existing:
                nodes.append(
                    self._node(
                        canonical.candidate_ids[question.candidate_key],
                        NodeType.QUESTION,
                        question.model_dump(
                            mode="json",
                            exclude={"candidate_key", "source_span_ids"},
                        ),
                        question.source_span_ids,
                        confidence=1.0,
                        model_run_id=model_run_id,
                    )
                )
        return nodes

    @staticmethod
    def _domain_id(workspace_id: UUID, name: str) -> UUID:
        return uuid5(workspace_id, f"domain:{canonical_text(name)}")

    @staticmethod
    def _content_ids_by_point(
        items: Sequence[_PointContentCandidate],
        canonical: CanonicalizationResult,
    ) -> dict[str, list[UUID]]:
        result: dict[str, list[UUID]] = {}
        for item in items:
            point_key = item.knowledge_point_candidate_id
            candidate_key = item.candidate_key
            result.setdefault(point_key, []).append(canonical.candidate_ids[candidate_key])
        return result

    @staticmethod
    def _stage_content_ids(
        selected_keys: list[str],
        defaults: list[UUID],
        canonical: CanonicalizationResult,
    ) -> list[UUID]:
        if not selected_keys:
            return list(defaults)
        return list(dict.fromkeys(canonical.candidate_ids[key] for key in selected_keys))

    @staticmethod
    def _node(
        node_id: UUID,
        node_type: NodeType,
        properties: dict[str, object],
        sources: list[UUID],
        *,
        confidence: float,
        model_run_id: UUID | None,
    ) -> NodeCreate:
        return NodeCreate.model_validate(
            {
                "id": node_id,
                "node_type": node_type,
                "properties": properties,
                "epistemic_status": EpistemicStatus.UNVERIFIED,
                "source_confidence": confidence,
                "source_span_ids": sources,
                "created_by": "knowledge_extractor",
                "model_run_id": model_run_id,
            }
        )

    @staticmethod
    def _node_provenance(
        blueprint: KnowledgeBlueprint,
        canonical: CanonicalizationResult,
    ) -> list[ProvenanceLink]:
        links: list[ProvenanceLink] = []

        def add_links(key: str, sources: list[UUID], confidence: float) -> None:
            links.extend(
                ProvenanceLink(
                    entity_id=canonical.candidate_ids[key],
                    source_span_id=source_id,
                    confidence=confidence,
                    extraction_method="knowledge_blueprint",
                )
                for source_id in sources
            )

        for theory in blueprint.theories:
            add_links(theory.candidate_key, theory.source_span_ids, theory.confidence)
        for point in blueprint.knowledge_points:
            add_links(point.candidate_key, point.source_span_ids, point.confidence)
        for example in blueprint.examples:
            add_links(example.candidate_key, example.source_span_ids, 1.0)
        for counterexample in blueprint.counterexamples:
            add_links(counterexample.candidate_key, counterexample.source_span_ids, 1.0)
        for misconception in blueprint.misconceptions:
            add_links(misconception.candidate_key, misconception.source_span_ids, 1.0)
        for question in blueprint.questions:
            add_links(question.candidate_key, question.source_span_ids, 1.0)
        return links

    @staticmethod
    def _candidate_assertions(
        blueprint: KnowledgeBlueprint,
        canonical: CanonicalizationResult,
        snapshot: GraphSnapshot,
        model_run_id: UUID | None,
    ) -> list[AssertionCreate]:
        relation_ids = {item.name: item.id for item in snapshot.relation_types}
        return [
            AssertionCreate(
                id=uuid5(
                    canonical.candidate_ids[item.subject_candidate_id],
                    f"{item.predicate}:{canonical.candidate_ids[item.object_candidate_id]}",
                ),
                subject_id=canonical.candidate_ids[item.subject_candidate_id],
                relation_type_id=relation_ids.get(item.predicate),
                predicate_key=item.predicate,
                object_id=canonical.candidate_ids[item.object_candidate_id],
                natural_language_description=item.natural_language_description,
                confidence=item.confidence,
                epistemic_status=EpistemicStatus.UNVERIFIED,
                source_span_ids=item.source_span_ids,
                created_by="knowledge_extractor",
                model_run_id=model_run_id,
                metadata={"model_proposed_temporal": item.temporal},
            )
            for item in blueprint.relations
        ]

    @staticmethod
    def _implicit_assertions(
        blueprint: KnowledgeBlueprint,
        canonical: CanonicalizationResult,
        snapshot: GraphSnapshot,
        model_run_id: UUID | None,
    ) -> list[AssertionCreate]:
        result: list[AssertionCreate] = []
        relation_ids = {item.name: item.id for item in snapshot.relation_types}

        def add_ids(
            subject_id: UUID,
            predicate: RelationTypeKey,
            object_id: UUID,
            description: str,
            sources: list[UUID],
        ) -> None:
            result.append(
                AssertionCreate(
                    id=uuid5(subject_id, f"{predicate}:{object_id}"),
                    subject_id=subject_id,
                    relation_type_id=relation_ids.get(predicate),
                    predicate_key=predicate,
                    object_id=object_id,
                    natural_language_description=description,
                    confidence=0.9,
                    epistemic_status=EpistemicStatus.UNVERIFIED,
                    source_span_ids=sources,
                    created_by="blueprint_builder",
                    model_run_id=model_run_id,
                )
            )

        def add(
            subject_key: str,
            predicate: RelationTypeKey,
            object_key: str,
            description: str,
            sources: list[UUID],
        ) -> None:
            subject_id = canonical.candidate_ids[subject_key]
            object_id = canonical.candidate_ids[object_key]
            add_ids(subject_id, predicate, object_id, description, sources)

        for point in blueprint.knowledge_points:
            for prerequisite in point.prerequisites:
                add(
                    point.candidate_key,
                    RelationTypeKey.REQUIRES,
                    prerequisite,
                    f"{point.canonical_name} requires {prerequisite}.",
                    point.source_span_ids,
                )
            point_id = canonical.candidate_ids[point.candidate_key]
            if blueprint.domain:
                add_ids(
                    point_id,
                    RelationTypeKey.PART_OF,
                    BlueprintGraphDeltaBuilder._domain_id(
                        snapshot.workspace_id,
                        blueprint.domain,
                    ),
                    f"{point.canonical_name} belongs to {blueprint.domain}.",
                    point.source_span_ids,
                )
            explicit_questions = {
                int(question.cognitive_level): canonical.candidate_ids[question.candidate_key]
                for question in blueprint.questions
                if question.knowledge_point_candidate_id == point.candidate_key
            }
            for stage in point.six_level_plan:
                stage_id = uuid5(
                    point_id,
                    f"learning-stage:{int(stage.cognitive_level)}",
                )
                add_ids(
                    stage_id,
                    RelationTypeKey.TEACHES,
                    point_id,
                    "This stage teaches one cognitive level of the knowledge point.",
                    point.source_span_ids,
                )
                question_id = explicit_questions.get(int(stage.cognitive_level)) or uuid5(
                    stage_id,
                    "diagnostic-question",
                )
                add_ids(
                    question_id,
                    RelationTypeKey.ASSESSES,
                    stage_id,
                    "This diagnostic question assesses the learning stage.",
                    point.source_span_ids,
                )
        for example in blueprint.examples:
            add(
                example.candidate_key,
                RelationTypeKey.EXAMPLE_OF,
                example.knowledge_point_candidate_id,
                "This source-grounded item is an example of the knowledge point.",
                example.source_span_ids,
            )
        for counterexample in blueprint.counterexamples:
            add(
                counterexample.candidate_key,
                RelationTypeKey.COUNTEREXAMPLE_OF,
                counterexample.knowledge_point_candidate_id,
                counterexample.boundary_explained,
                counterexample.source_span_ids,
            )
        for misconception in blueprint.misconceptions:
            add(
                misconception.candidate_key,
                RelationTypeKey.MISCONCEPTION_ABOUT,
                misconception.knowledge_point_candidate_id,
                misconception.correction,
                misconception.source_span_ids,
            )
        for question in blueprint.questions:
            add(
                question.candidate_key,
                RelationTypeKey.ASSESSES,
                question.knowledge_point_candidate_id,
                "This question assesses the stated cognitive level.",
                question.source_span_ids,
            )
        return result

    @staticmethod
    def _validate_source_references(
        blueprint: KnowledgeBlueprint,
        known_span_ids: set[UUID],
    ) -> None:
        referenced: set[UUID] = set()
        source_lists = (
            [item.source_span_ids for item in blueprint.theories]
            + [item.source_span_ids for item in blueprint.knowledge_points]
            + [item.source_span_ids for item in blueprint.relations]
            + [item.source_span_ids for item in blueprint.examples]
            + [item.source_span_ids for item in blueprint.counterexamples]
            + [item.source_span_ids for item in blueprint.misconceptions]
            + [item.source_span_ids for item in blueprint.questions]
        )
        for source_ids in source_lists:
            referenced.update(source_ids)
        unknown = referenced.difference(known_span_ids)
        if unknown:
            raise ValueError(f"blueprint references {len(unknown)} unknown source spans")

    @staticmethod
    def _unique_new_nodes(nodes: list[NodeCreate], snapshot: GraphSnapshot) -> list[NodeCreate]:
        existing = set(snapshot.node_map())
        unique: dict[UUID, NodeCreate] = {}
        for node in nodes:
            if node.id in existing:
                continue
            prior = unique.get(node.id)
            if prior is None:
                unique[node.id] = node
                continue
            if prior.node_type is not node.node_type:
                raise ValueError("canonicalized node identity cannot cross entity types")
            unique[node.id] = prior.model_copy(
                update={
                    "source_confidence": max(
                        prior.source_confidence,
                        node.source_confidence,
                    ),
                    "source_span_ids": list(
                        dict.fromkeys([*prior.source_span_ids, *node.source_span_ids])
                    ),
                }
            )
        return list(unique.values())

    @staticmethod
    def _unique_assertions(items: list[AssertionCreate]) -> list[AssertionCreate]:
        unique: dict[tuple[UUID, RelationTypeKey, UUID], AssertionCreate] = {}
        for item in items:
            key = (item.subject_id, item.predicate_key, item.object_id)
            existing = unique.get(key)
            if existing is None:
                unique[key] = item
                continue
            raw_descriptions = existing.metadata.get("alternate_descriptions", [])
            descriptions = (
                [str(value) for value in raw_descriptions if isinstance(value, str)]
                if isinstance(raw_descriptions, list)
                else []
            )
            if item.natural_language_description != existing.natural_language_description:
                descriptions.append(item.natural_language_description)
            metadata = dict(existing.metadata)
            if descriptions:
                metadata["alternate_descriptions"] = list(dict.fromkeys(descriptions))
            unique[key] = existing.model_copy(
                update={
                    "confidence": max(existing.confidence, item.confidence),
                    "source_span_ids": list(
                        dict.fromkeys([*existing.source_span_ids, *item.source_span_ids])
                    ),
                    "metadata": metadata,
                }
            )
        return list(unique.values())

    @staticmethod
    def _unique_provenance(items: list[ProvenanceLink]) -> list[ProvenanceLink]:
        unique: dict[tuple[UUID, UUID], ProvenanceLink] = {}
        for item in items:
            unique.setdefault((item.entity_id, item.source_span_id), item)
        return list(unique.values())
