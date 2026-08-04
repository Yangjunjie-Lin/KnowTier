"""Deterministic domain and SHACL validation before graph persistence."""

from __future__ import annotations

from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from uuid import UUID

from pydantic import Field
from rdflib import Graph

from cognigraph.domain.base import DomainModel
from cognigraph.domain.enums import EpistemicStatus, NodeType, RelationTypeKey
from cognigraph.graph.applier import GraphNode, GraphSnapshot
from cognigraph.graph.delta import AssertionCreate, GraphDelta


class ValidationIssue(DomainModel):
    code: str
    message: str
    entity_id: UUID | None = None


class GraphValidationResult(DomainModel):
    conforms: bool
    issues: list[ValidationIssue] = Field(default_factory=list)
    report_text: str = ""


class GraphDeltaValidator:
    """Validate references, provenance and prerequisite acyclicity deterministically."""

    def validate(self, delta: GraphDelta, snapshot: GraphSnapshot) -> GraphValidationResult:
        issues: list[ValidationIssue] = []
        if snapshot.workspace_id != delta.workspace_id:
            issues.append(
                ValidationIssue(code="WORKSPACE_MISMATCH", message="snapshot workspace differs")
            )
        if snapshot.revision_id != delta.base_revision_id:
            issues.append(
                ValidationIssue(code="STALE_REVISION", message="delta is based on a stale revision")
            )

        existing_nodes = snapshot.node_map()
        known_node_ids = set(existing_nodes).union(node.id for node in delta.add_nodes)
        known_source_ids = {span.id for span in snapshot.source_spans}.union(
            node.id for node in delta.add_nodes if node.node_type is NodeType.SOURCE_SPAN
        )
        known_source_ids.update(
            node.id for node in snapshot.nodes if node.node_type is NodeType.SOURCE_SPAN
        )
        for patch in delta.update_nodes:
            if patch.node_id not in existing_nodes:
                issues.append(
                    ValidationIssue(
                        code="UNKNOWN_PATCH_NODE",
                        message="node patch refers to an unknown node",
                        entity_id=patch.node_id,
                    )
                )
        for node in delta.add_nodes:
            if node.id in existing_nodes:
                issues.append(
                    ValidationIssue(
                        code="DUPLICATE_NODE_ID",
                        message="new node id already exists",
                        entity_id=node.id,
                    )
                )
            if node.node_type not in {
                NodeType.SOURCE_DOCUMENT,
                NodeType.SOURCE_SPAN,
                NodeType.ENTITY_TYPE,
                NodeType.RELATION_TYPE,
                NodeType.CONSTRAINT,
                NodeType.EPISTEMIC_STATUS,
            }:
                issues.extend(
                    _missing_sources(
                        node.id,
                        node.epistemic_status,
                        node.source_span_ids,
                        known_source_ids,
                    )
                )

        existing_assertions = snapshot.assertion_map()
        added_assertion_ids = {assertion.id for assertion in delta.add_assertions}
        added_assertions = {assertion.id: assertion for assertion in delta.add_assertions}
        for assertion in delta.add_assertions:
            if assertion.id in existing_assertions:
                issues.append(
                    ValidationIssue(
                        code="DUPLICATE_ASSERTION_ID",
                        message="new assertion id already exists",
                        entity_id=assertion.id,
                    )
                )
            if assertion.subject_id not in known_node_ids:
                issues.append(
                    ValidationIssue(
                        code="UNKNOWN_SUBJECT",
                        message="assertion subject does not exist",
                        entity_id=assertion.id,
                    )
                )
            if assertion.object_id not in known_node_ids:
                issues.append(
                    ValidationIssue(
                        code="UNKNOWN_OBJECT",
                        message="assertion object does not exist",
                        entity_id=assertion.id,
                    )
                )
            if (
                assertion.relation_type_id is not None
                and assertion.relation_type_id not in known_node_ids
            ):
                issues.append(
                    ValidationIssue(
                        code="UNKNOWN_RELATION_TYPE",
                        message="assertion relation_type_id does not exist",
                        entity_id=assertion.id,
                    )
                )
            issues.extend(
                _missing_sources(
                    assertion.id,
                    assertion.epistemic_status,
                    assertion.source_span_ids,
                    known_source_ids,
                )
            )
            issues.extend(_relation_contract_issues(assertion, delta, snapshot, known_node_ids))
            issues.extend(_existing_relation_issues(assertion, delta, snapshot))
        for item in delta.supersede_assertions:
            historical = existing_assertions.get(item.assertion_id)
            replacement = added_assertions.get(item.replacement_assertion_id)
            if historical is None:
                issues.append(
                    ValidationIssue(
                        code="UNKNOWN_SUPERSEDED_ASSERTION",
                        message="supersede operation refers to an unknown historical assertion",
                        entity_id=item.assertion_id,
                    )
                )
            if replacement is None:
                issues.append(
                    ValidationIssue(
                        code="UNKNOWN_REPLACEMENT_ASSERTION",
                        message="replacement assertion is not added by this delta",
                        entity_id=item.replacement_assertion_id,
                    )
                )
            if historical is not None and replacement is not None:
                if (
                    historical.subject_id != replacement.subject_id
                    or historical.predicate_key is not replacement.predicate_key
                ):
                    issues.append(
                        ValidationIssue(
                            code="UNRELATED_ASSERTION_REPLACEMENT",
                            message=(
                                "a replacement must retain the historical assertion's "
                                "subject and predicate"
                            ),
                            entity_id=item.replacement_assertion_id,
                        )
                    )
                descriptor = next(
                    (
                        relation
                        for relation in snapshot.relation_types
                        if relation.name is historical.predicate_key
                    ),
                    None,
                )
                if historical.object_id != replacement.object_id and (
                    descriptor is None or not descriptor.temporal
                ):
                    issues.append(
                        ValidationIssue(
                            code="NON_TEMPORAL_ASSERTION_REPLACEMENT",
                            message=(
                                "a non-temporal competing object must be retained in a "
                                "ConflictSet rather than superseded"
                            ),
                            entity_id=item.replacement_assertion_id,
                        )
                    )
                if item.superseded_at < historical.valid_from:
                    issues.append(
                        ValidationIssue(
                            code="INVALID_SUPERSEDE_TIME",
                            message="superseded_at cannot precede the old assertion",
                            entity_id=item.assertion_id,
                        )
                    )

        known_assertion_ids = set(existing_assertions).union(added_assertion_ids)
        for merge in delta.merge_candidates:
            for node_id in (merge.source_node_id, merge.target_node_id):
                if node_id not in known_node_ids:
                    issues.append(
                        ValidationIssue(
                            code="UNKNOWN_MERGE_NODE",
                            message="merge candidate refers to an unknown node",
                            entity_id=node_id,
                        )
                    )
        for conflict in delta.conflicts:
            for assertion_id in conflict.assertion_ids:
                if assertion_id not in known_assertion_ids:
                    issues.append(
                        ValidationIssue(
                            code="UNKNOWN_CONFLICT_ASSERTION",
                            message="conflict candidate refers to an unknown assertion",
                            entity_id=assertion_id,
                        )
                    )

        provenance_targets = known_node_ids.union(existing_assertions, added_assertion_ids)
        for link in delta.add_provenance_links:
            if link.entity_id not in provenance_targets:
                issues.append(
                    ValidationIssue(
                        code="UNKNOWN_PROVENANCE_TARGET",
                        message="provenance link target does not exist",
                        entity_id=link.entity_id,
                    )
                )
            if link.source_span_id not in known_source_ids:
                issues.append(
                    ValidationIssue(
                        code="UNKNOWN_SOURCE_SPAN",
                        message="provenance link source span does not exist",
                        entity_id=link.source_span_id,
                    )
                )

        if _has_unmarked_prerequisite_cycle(snapshot, delta):
            issues.append(
                ValidationIssue(
                    code="PREREQUISITE_CYCLE",
                    message="REQUIRES assertions would introduce an unmarked cycle",
                )
            )
        return GraphValidationResult(conforms=not issues, issues=issues)

    def require_valid(self, delta: GraphDelta, snapshot: GraphSnapshot) -> None:
        result = self.validate(delta, snapshot)
        if not result.conforms:
            details = "; ".join(f"{item.code}: {item.message}" for item in result.issues)
            raise ValueError(f"GraphDelta validation failed: {details}")


@dataclass(frozen=True, slots=True)
class ShaclGraphValidator:
    """Validate an RDF projection using pySHACL without coupling to Neo4j."""

    inference: str = "rdfs"

    def validate(self, data_graph: Graph, shapes_graph: Graph) -> GraphValidationResult:
        from pyshacl import validate as shacl_validate

        conforms, _report_graph, report_text = shacl_validate(
            data_graph=data_graph,
            shacl_graph=shapes_graph,
            inference=self.inference,
            abort_on_first=False,
            allow_infos=True,
            allow_warnings=True,
        )
        issue = [] if conforms else [ValidationIssue(code="SHACL_VIOLATION", message=report_text)]
        return GraphValidationResult(
            conforms=bool(conforms), issues=issue, report_text=str(report_text)
        )

    def validate_snapshot(
        self, snapshot: GraphSnapshot, shapes_graph: Graph | None = None
    ) -> GraphValidationResult:
        from cognigraph.graph.exporters import GraphExporter

        data_graph = GraphExporter().to_rdf_graph(snapshot)
        return self.validate(data_graph, shapes_graph or default_shapes_graph())

    @staticmethod
    def implementation_version() -> str:
        try:
            return version("pyshacl")
        except PackageNotFoundError:
            return "unknown"


def _missing_sources(
    entity_id: UUID,
    status: EpistemicStatus,
    source_ids: list[UUID],
    known_source_ids: set[UUID],
) -> list[ValidationIssue]:
    issues = [
        ValidationIssue(
            code="UNKNOWN_SOURCE_SPAN",
            message="entity refers to an unknown source span",
            entity_id=entity_id,
        )
        for source_id in source_ids
        if source_id not in known_source_ids
    ]
    if status is EpistemicStatus.CONFIRMED and not source_ids:
        issues.append(
            ValidationIssue(
                code="CONFIRMED_WITHOUT_SOURCE",
                message="confirmed graph entities require source evidence",
                entity_id=entity_id,
            )
        )
    return issues


def _has_unmarked_prerequisite_cycle(snapshot: GraphSnapshot, delta: GraphDelta) -> bool:
    superseded_ids = {item.assertion_id for item in delta.supersede_assertions}
    edges = {
        (assertion.subject_id, assertion.object_id)
        for assertion in snapshot.assertions
        if assertion.is_active
        and assertion.id not in superseded_ids
        and assertion.predicate_key is RelationTypeKey.REQUIRES
    }
    edges.update(
        (assertion.subject_id, assertion.object_id)
        for assertion in delta.add_assertions
        if assertion.predicate_key is RelationTypeKey.REQUIRES
        and not bool(assertion.metadata.get("cycle_allowed", False))
    )
    adjacency: dict[UUID, set[UUID]] = {}
    for subject, object_ in edges:
        adjacency.setdefault(subject, set()).add(object_)
        adjacency.setdefault(object_, set())
    temporary: set[UUID] = set()
    permanent: set[UUID] = set()

    def visit(node_id: UUID) -> bool:
        if node_id in temporary:
            return True
        if node_id in permanent:
            return False
        temporary.add(node_id)
        if any(visit(neighbor) for neighbor in adjacency[node_id]):
            return True
        temporary.remove(node_id)
        permanent.add(node_id)
        return False

    return any(visit(node_id) for node_id in adjacency if node_id not in permanent)


def _relation_contract_issues(
    assertion: AssertionCreate,
    delta: GraphDelta,
    snapshot: GraphSnapshot,
    known_node_ids: set[UUID],
) -> list[ValidationIssue]:
    descriptor = next(
        (
            relation
            for relation in snapshot.relation_types
            if relation.id == assertion.relation_type_id or relation.name is assertion.predicate_key
        ),
        None,
    )
    if descriptor is None:
        return []
    if assertion.relation_type_id is not None and assertion.relation_type_id != descriptor.id:
        return [
            ValidationIssue(
                code="RELATION_TYPE_ID_MISMATCH",
                message="relation_type_id does not match predicate_key",
                entity_id=assertion.id,
            )
        ]
    nodes = snapshot.node_map()
    nodes.update(
        {node.id: node for node in _temporary_nodes(delta, snapshot) if node.id in known_node_ids}
    )
    subject_type = nodes[assertion.subject_id].node_type if assertion.subject_id in nodes else None
    object_type = nodes[assertion.object_id].node_type if assertion.object_id in nodes else None
    issues: list[ValidationIssue] = []
    if subject_type is not None and subject_type not in descriptor.domain_types:
        issues.append(
            ValidationIssue(
                code="RELATION_DOMAIN_MISMATCH",
                message=f"{descriptor.name.value} does not allow subject type {subject_type.value}",
                entity_id=assertion.id,
            )
        )
    if object_type is not None and object_type not in descriptor.range_types:
        issues.append(
            ValidationIssue(
                code="RELATION_RANGE_MISMATCH",
                message=f"{descriptor.name.value} does not allow object type {object_type.value}",
                entity_id=assertion.id,
            )
        )
    return issues


def _temporary_nodes(delta: GraphDelta, snapshot: GraphSnapshot) -> list[GraphNode]:
    revision_id = snapshot.revision_id or delta.id
    return [
        GraphNode(
            id=node.id,
            workspace_id=delta.workspace_id,
            node_type=node.node_type,
            properties=node.properties,
            epistemic_status=node.epistemic_status,
            source_span_ids=node.source_span_ids,
            graph_revision_id=revision_id,
        )
        for node in delta.add_nodes
    ]


def _existing_relation_issues(
    assertion: AssertionCreate, delta: GraphDelta, snapshot: GraphSnapshot
) -> list[ValidationIssue]:
    same_predicate = [
        item
        for item in snapshot.assertions
        if item.is_active
        and item.subject_id == assertion.subject_id
        and item.predicate_key is assertion.predicate_key
    ]
    same_object = [item for item in same_predicate if item.object_id == assertion.object_id]
    explicitly_replaced = {
        item.assertion_id
        for item in delta.supersede_assertions
        if item.replacement_assertion_id == assertion.id
    }
    if same_object and not {item.id for item in same_object}.issubset(explicitly_replaced):
        return [
            ValidationIssue(
                code="DUPLICATE_ASSERTION",
                message="merge provenance into the existing subject-predicate-object assertion",
                entity_id=assertion.id,
            )
        ]
    competing = [item for item in same_predicate if item.object_id != assertion.object_id]
    if not competing:
        return []
    descriptor = next(
        (item for item in snapshot.relation_types if item.name is assertion.predicate_key), None
    )
    competing_ids = {item.id for item in competing}
    if descriptor is not None and descriptor.temporal:
        closed = {
            item.assertion_id
            for item in delta.supersede_assertions
            if item.replacement_assertion_id == assertion.id
        }
        if competing_ids.issubset(closed):
            return []
        code = "TEMPORAL_ASSERTION_NOT_SUPERSEDED"
        message = "temporal replacement must close every competing active assertion"
    else:
        conflict_sets = [set(item.assertion_ids) for item in delta.conflicts]
        declared = all(
            any({item.id, assertion.id}.issubset(group) for group in conflict_sets)
            for item in competing
        )
        if declared:
            return []
        code = "UNDECLARED_RELATION_CONFLICT"
        message = "non-temporal competing assertions require an explicit conflict candidate"
    return [ValidationIssue(code=code, message=message, entity_id=assertion.id)]


def default_shapes_graph() -> Graph:
    """Return the built-in SHACL constraints for first-class relation assertions."""

    shapes = Graph()
    shapes.parse(
        data="""
            @prefix cg: <https://cognigraph.example/ontology/> .
            @prefix sh: <http://www.w3.org/ns/shacl#> .
            @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

            cg:RelationAssertionShape a sh:NodeShape ;
                sh:targetClass cg:RelationAssertion ;
                sh:property [ sh:path cg:subject ; sh:minCount 1 ; sh:maxCount 1 ] ;
                sh:property [ sh:path cg:object ; sh:minCount 1 ; sh:maxCount 1 ] ;
                sh:property [ sh:path cg:predicate ; sh:minCount 1 ; sh:maxCount 1 ] ;
                sh:property [
                    sh:path cg:confidence ; sh:minCount 1 ; sh:maxCount 1 ;
                    sh:minInclusive 0 ; sh:maxInclusive 1
                ] ;
                sh:property [ sh:path cg:epistemicStatus ; sh:minCount 1 ; sh:maxCount 1 ] ;
                sh:property [ sh:path cg:graphRevisionId ; sh:minCount 1 ; sh:maxCount 1 ] .
        """,
        format="turtle",
    )
    return shapes
