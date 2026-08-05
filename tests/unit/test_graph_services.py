from __future__ import annotations

import json
from uuid import UUID, uuid4

import pytest
from rdflib import Graph

from cognigraph.domain.documents import SourceSpan
from cognigraph.domain.enums import EpistemicStatus, NodeType, RelationTypeKey, TeachingAction
from cognigraph.domain.graph import RelationAssertion
from cognigraph.domain.teaching import (
    ContextNode,
    SessionGoal,
    TeachingPolicy,
)
from cognigraph.graph.applier import GraphNode, GraphSnapshot, InMemoryGraphStore
from cognigraph.graph.context_compiler import (
    ContextCandidates,
    ContextCompilationRequest,
    GraphContextCompiler,
)
from cognigraph.graph.exporters import CG, CG_RESOURCE, GraphExporter
from cognigraph.graph.manifest import GraphManifestService
from cognigraph.graph.query_tools import (
    ControlledGraphQueryTools,
    InMemoryToolAuditSink,
    LearningPathParams,
    NodeDetailParams,
    PrerequisiteChainParams,
    SearchKnowledgePointsParams,
)
from cognigraph.graph.validator import ShaclGraphValidator, default_shapes_graph


def _source_span(document_id: UUID) -> SourceSpan:
    return SourceSpan(
        document_id=document_id,
        page_number=2,
        heading_path=["Bayesian inference"],
        text="Bayesian updating uses conditional probability.",
        normalized_text="Bayesian updating uses conditional probability.",
        start_offset=0,
        end_offset=47,
        content_hash="2" * 64,
        parser_name="docling",
        parser_version="2.25",
    )


def _snapshot() -> tuple[GraphSnapshot, UUID, UUID, UUID]:
    workspace_id = uuid4()
    revision_id = uuid4()
    document_id = uuid4()
    span = _source_span(document_id)
    bayes_id = uuid4()
    prerequisite_id = uuid4()
    nodes = [
        GraphNode(
            id=document_id,
            workspace_id=workspace_id,
            node_type=NodeType.SOURCE_DOCUMENT,
            properties={"name": "bayes.pdf"},
            epistemic_status=EpistemicStatus.CONFIRMED,
            graph_revision_id=revision_id,
        ),
        GraphNode(
            id=bayes_id,
            workspace_id=workspace_id,
            node_type=NodeType.KNOWLEDGE_POINT,
            properties={
                "canonical_name": "bayesian updating",
                "display_name": "Bayesian updating",
                "summary": "Updating beliefs using evidence.",
                "domain": "Probability",
            },
            epistemic_status=EpistemicStatus.CONFIRMED,
            source_span_ids=[span.id],
            graph_revision_id=revision_id,
        ),
        GraphNode(
            id=prerequisite_id,
            workspace_id=workspace_id,
            node_type=NodeType.KNOWLEDGE_POINT,
            properties={
                "canonical_name": "conditional probability",
                "display_name": "Conditional probability",
                "summary": "Probability under a condition.",
                "domain": "Probability",
            },
            epistemic_status=EpistemicStatus.CONFIRMED,
            source_span_ids=[span.id],
            graph_revision_id=revision_id,
        ),
    ]
    assertion = RelationAssertion(
        workspace_id=workspace_id,
        subject_id=bayes_id,
        predicate_key=RelationTypeKey.REQUIRES,
        object_id=prerequisite_id,
        natural_language_description="Bayesian updating requires conditional probability.",
        confidence=0.95,
        epistemic_status=EpistemicStatus.CONFIRMED,
        created_by="extractor",
        source_span_ids=[span.id],
        model_run_id=uuid4(),
        graph_revision_id=revision_id,
    )
    snapshot = GraphSnapshot(
        workspace_id=workspace_id,
        revision_id=revision_id,
        revision_sequence=1,
        nodes=nodes,
        assertions=[assertion],
        source_spans=[span],
    )
    return snapshot, bayes_id, prerequisite_id, assertion.id


def test_manifest_is_compact_and_cached_by_revision() -> None:
    snapshot, _bayes_id, _prerequisite_id, _assertion_id = _snapshot()
    service = GraphManifestService()
    manifest = service.build(snapshot)
    assert manifest.knowledge_point_count == 2
    assert manifest.assertion_count == 1
    assert manifest.source_count == 1
    assert manifest.top_level_domains == []
    assert manifest.major_clusters[0].name == "Probability"

    extra = snapshot.nodes[1].model_copy(update={"id": uuid4()})
    unchanged_revision = snapshot.model_copy(update={"nodes": [*snapshot.nodes, extra]})
    assert service.build(unchanged_revision).knowledge_point_count == 2

    new_revision = unchanged_revision.model_copy(update={"revision_id": uuid4()})
    assert service.build(new_revision).knowledge_point_count == 3


def test_context_compiler_enforces_deterministic_budget_and_priority() -> None:
    snapshot, bayes_id, prerequisite_id, _assertion_id = _snapshot()
    manifest = GraphManifestService().build(snapshot)
    current = ContextNode(
        id=bayes_id,
        node_type=NodeType.KNOWLEDGE_POINT.value,
        name="Bayesian updating",
        summary="Update a prior belief.",
        relevance=1.0,
    )
    too_large_prerequisite = ContextNode(
        id=prerequisite_id,
        node_type=NodeType.KNOWLEDGE_POINT.value,
        name="Conditional probability",
        summary="x" * 4_000,
        relevance=1.0,
    )
    compiler = GraphContextCompiler()
    request = ContextCompilationRequest(
        workspace_id=snapshot.workspace_id,
        learner_id=uuid4(),
        session_id=uuid4(),
        user_message="Teach me Bayes.",
        target_knowledge_point_id=bayes_id,
        token_budget=600,
    )
    policy = TeachingPolicy(allowed_next_actions=[TeachingAction.EXPLAIN_INTUITIVELY])
    candidates = ContextCandidates(
        current_knowledge_point=current,
        prerequisite_chain=[too_large_prerequisite],
        relevant_misconceptions=["A posterior is not the same thing as a likelihood."],
        current_teaching_stage={
            "cognitive_level": 1,
            "learning_objective": "Recognize Bayesian updating.",
        },
    )
    first = compiler.compile(request, manifest, candidates, SessionGoal(), policy)
    second = compiler.compile(request, manifest, candidates, SessionGoal(), policy)

    assert first.model_dump(mode="json") == second.model_dump(mode="json")
    assert [node.id for node in first.focus_nodes] == [bayes_id]
    assert first.prerequisite_chain == []
    assert first.current_teaching_stage["cognitive_level"] == 1
    assert first.allowed_next_actions == [TeachingAction.EXPLAIN_INTUITIVELY]
    assert first.truncated
    assert first.estimated_tokens <= request.token_budget


def test_controlled_query_tools_are_bounded_versioned_and_audited() -> None:
    snapshot, bayes_id, prerequisite_id, _assertion_id = _snapshot()
    store = InMemoryGraphStore()
    store.set_snapshot(snapshot)
    audit = InMemoryToolAuditSink()
    tools = ControlledGraphQueryTools(store, audit)

    search = tools.search_knowledge_points(
        SearchKnowledgePointsParams(
            workspace_id=snapshot.workspace_id,
            query="Bayesian",
            limit=1,
        )
    )
    assert search.graph_revision_id == snapshot.revision_id
    assert search.data["items"][0]["id"] == str(bayes_id)  # type: ignore[index]

    chain = tools.get_prerequisite_chain(
        PrerequisiteChainParams(
            workspace_id=snapshot.workspace_id,
            knowledge_point_id=bayes_id,
            max_depth=1,
            max_nodes=2,
        )
    )
    returned_ids = {item["id"] for item in chain.data["nodes"]}  # type: ignore[union-attr]
    assert returned_ids == {str(bayes_id), str(prerequisite_id)}

    detail = tools.get_node_detail(
        NodeDetailParams(workspace_id=snapshot.workspace_id, node_id=bayes_id)
    )
    assert len(detail.data["sources"]) == 1  # type: ignore[arg-type]
    assert [record.tool_name for record in audit.records] == [
        "search_knowledge_points",
        "get_prerequisite_chain",
        "get_node_detail",
    ]
    assert not hasattr(tools, "execute_cypher")


def test_multilevel_learning_path_is_stable_and_prerequisites_first() -> None:
    workspace_id = UUID(int=101)
    revision_id = UUID(int=102)
    target_id = UUID(int=110)
    direct_a_id = UUID(int=111)
    direct_b_id = UUID(int=112)
    foundation_id = UUID(int=113)
    node_ids = [target_id, direct_a_id, direct_b_id, foundation_id]
    nodes = [
        GraphNode(
            id=node_id,
            workspace_id=workspace_id,
            node_type=NodeType.KNOWLEDGE_POINT,
            properties={"canonical_name": f"point-{node_id.int}"},
            epistemic_status=EpistemicStatus.CONFIRMED,
            graph_revision_id=revision_id,
        )
        for node_id in node_ids
    ]

    def requires(assertion_id: int, subject_id: UUID, object_id: UUID) -> RelationAssertion:
        return RelationAssertion(
            id=UUID(int=assertion_id),
            workspace_id=workspace_id,
            subject_id=subject_id,
            predicate_key=RelationTypeKey.REQUIRES,
            object_id=object_id,
            natural_language_description="A deterministic prerequisite edge.",
            confidence=1.0,
            epistemic_status=EpistemicStatus.UNVERIFIED,
            created_by="test",
            graph_revision_id=revision_id,
        )

    assertions = [
        requires(201, target_id, direct_b_id),
        requires(202, target_id, direct_a_id),
        requires(203, direct_a_id, foundation_id),
    ]
    snapshot = GraphSnapshot(
        workspace_id=workspace_id,
        revision_id=revision_id,
        nodes=nodes,
        assertions=assertions,
    )
    store = InMemoryGraphStore()
    store.set_snapshot(snapshot)
    tools = ControlledGraphQueryTools(store)

    first = tools.get_learning_path(
        LearningPathParams(
            workspace_id=workspace_id,
            target_knowledge_point_id=target_id,
            max_depth=3,
            max_nodes=10,
        )
    )
    second = tools.get_learning_path(
        LearningPathParams(
            workspace_id=workspace_id,
            target_knowledge_point_id=target_id,
            max_depth=3,
            max_nodes=10,
        )
    )

    ordered = first.data["knowledge_point_ids"]
    assert ordered == second.data["knowledge_point_ids"]
    assert ordered.index(str(foundation_id)) < ordered.index(str(direct_a_id))
    assert ordered.index(str(direct_a_id)) < ordered.index(str(target_id))
    assert ordered.index(str(direct_b_id)) < ordered.index(str(target_id))

    cyclic_snapshot = snapshot.model_copy(
        update={
            "assertions": [
                *assertions,
                requires(204, foundation_id, target_id),
            ]
        }
    )
    store.set_snapshot(cyclic_snapshot)
    with pytest.raises(ValueError, match="cycle"):
        tools.get_learning_path(
            LearningPathParams(
                workspace_id=workspace_id,
                target_knowledge_point_id=target_id,
                max_depth=5,
                max_nodes=10,
            )
        )


def test_cytoscape_and_jsonld_exports_preserve_assertion_identity() -> None:
    snapshot, bayes_id, prerequisite_id, assertion_id = _snapshot()
    exporter = GraphExporter()
    cytoscape = exporter.export_cytoscape(snapshot)
    edges = cytoscape["elements"]["edges"]  # type: ignore[index]
    edge_data = edges[0]["data"]  # type: ignore[index]
    assert edge_data["assertion_id"] == str(assertion_id)
    assert edge_data["source"] == str(bayes_id)
    assert edge_data["target"] == str(prerequisite_id)

    jsonld = exporter.export_jsonld(snapshot)
    parsed_jsonld = Graph().parse(data=json.dumps(jsonld), format="json-ld")
    assert len(parsed_jsonld) > 0
    assert (CG_RESOURCE[str(assertion_id)], None, None) in parsed_jsonld


def test_turtle_and_default_shacl_validate_first_class_assertions() -> None:
    snapshot, _bayes_id, _prerequisite_id, assertion_id = _snapshot()
    exporter = GraphExporter()
    turtle = exporter.export_turtle(snapshot)
    parsed = Graph().parse(data=turtle, format="turtle")
    assert (CG_RESOURCE[str(assertion_id)], None, None) in parsed

    validator = ShaclGraphValidator(inference="none")
    assert validator.validate_snapshot(snapshot).conforms

    data_graph = exporter.to_rdf_graph(snapshot)
    confidence_triples = list(
        data_graph.triples((CG_RESOURCE[str(assertion_id)], CG.confidence, None))
    )
    for triple in confidence_triples:
        data_graph.remove(triple)
    assert not validator.validate(data_graph, default_shapes_graph()).conforms
