"""Cytoscape, JSON-LD and Turtle graph exports with assertion provenance."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from rdflib import RDF, Graph, Namespace, URIRef
from rdflib import Literal as RdfLiteral
from rdflib.namespace import XSD

from cognigraph.domain.base import JsonObject, JsonValue
from cognigraph.graph.applier import GraphNode, GraphSnapshot

CG = Namespace("https://cognigraph.example/ontology/")
CG_RESOURCE = Namespace("https://cognigraph.example/resource/")


class GraphExporter:
    def export_cytoscape(self, snapshot: GraphSnapshot) -> JsonObject:
        nodes: list[JsonValue] = []
        edges: list[JsonValue] = []
        for node in sorted(snapshot.nodes, key=lambda item: str(item.id)):
            data: JsonObject = {
                "id": str(node.id),
                "type": node.node_type.value,
                "label": _node_label(node),
                "epistemic_status": node.epistemic_status.value,
                "source_confidence": node.source_confidence,
                "source_count": len(node.source_span_ids),
                "model_run_id": str(node.model_run_id) if node.model_run_id else None,
                "properties": node.properties,
            }
            nodes.append({"data": data})
        for assertion in sorted(snapshot.assertions, key=lambda item: str(item.id)):
            data = {
                "id": str(assertion.id),
                "source": str(assertion.subject_id),
                "target": str(assertion.object_id),
                "assertion_id": str(assertion.id),
                "relation_type": assertion.predicate_key.value,
                "natural_language_description": assertion.natural_language_description,
                "confidence": assertion.confidence,
                "source_count": len(assertion.source_span_ids),
                "graph_revision_id": str(assertion.graph_revision_id),
                "model_run_id": (str(assertion.model_run_id) if assertion.model_run_id else None),
                "active": assertion.is_active,
            }
            edges.append({"data": data})
        return {
            "elements": {"nodes": nodes, "edges": edges},
            "meta": {
                "revision_id": str(snapshot.revision_id) if snapshot.revision_id else None,
                "generated_at": datetime.now(UTC).isoformat(),
            },
        }

    def export_jsonld(self, snapshot: GraphSnapshot) -> JsonObject:
        graph_items: list[JsonValue] = []
        for relation_type in sorted(snapshot.relation_types, key=lambda item: item.name.value):
            graph_items.append(
                {
                    "@id": f"cg-resource:{relation_type.id}",
                    "@type": "cg:RelationType",
                    "cg:name": relation_type.name.value,
                    "cg:description": relation_type.description,
                    "cg:inverseName": (
                        relation_type.inverse_name.value
                        if relation_type.inverse_name is not None
                        else None
                    ),
                    "cg:domainType": [item.value for item in relation_type.domain_types],
                    "cg:rangeType": [item.value for item in relation_type.range_types],
                    "cg:symmetric": relation_type.symmetric,
                    "cg:transitive": relation_type.transitive,
                    "cg:temporal": relation_type.temporal,
                    "cg:validationRules": relation_type.validation_rules,
                }
            )
        for node in sorted(snapshot.nodes, key=lambda item: str(item.id)):
            graph_items.append(
                {
                    "@id": f"cg-resource:{node.id}",
                    "@type": f"cg:{node.node_type.value}",
                    "cg:workspaceId": str(node.workspace_id),
                    "cg:epistemicStatus": node.epistemic_status.value,
                    "cg:sourceConfidence": node.source_confidence,
                    "cg:createdBy": node.created_by,
                    "cg:modelRunId": (
                        str(node.model_run_id) if node.model_run_id is not None else None
                    ),
                    "cg:graphRevisionId": str(node.graph_revision_id),
                    "cg:sourceSpan": [
                        {"@id": f"cg-resource:{source_id}"}
                        for source_id in sorted(node.source_span_ids, key=str)
                    ],
                    **{f"cg:property:{key}": value for key, value in node.properties.items()},
                }
            )
        for assertion in sorted(snapshot.assertions, key=lambda item: str(item.id)):
            graph_items.append(
                {
                    "@id": f"cg-resource:{assertion.id}",
                    "@type": "cg:RelationAssertion",
                    "cg:subject": {"@id": f"cg-resource:{assertion.subject_id}"},
                    "cg:object": {"@id": f"cg-resource:{assertion.object_id}"},
                    "cg:predicate": assertion.predicate_key.value,
                    "cg:description": assertion.natural_language_description,
                    "cg:confidence": assertion.confidence,
                    "cg:epistemicStatus": assertion.epistemic_status.value,
                    "cg:validFrom": assertion.valid_from.isoformat(),
                    "cg:validTo": assertion.valid_to.isoformat() if assertion.valid_to else None,
                    "cg:supersededAt": (
                        assertion.superseded_at.isoformat() if assertion.superseded_at else None
                    ),
                    "cg:createdAt": assertion.created_at.isoformat(),
                    "cg:createdBy": assertion.created_by,
                    "cg:modelRunId": (
                        str(assertion.model_run_id) if assertion.model_run_id is not None else None
                    ),
                    "cg:relationTypeId": (
                        str(assertion.relation_type_id)
                        if assertion.relation_type_id is not None
                        else None
                    ),
                    "cg:supersedes": (
                        {"@id": f"cg-resource:{assertion.supersedes_assertion_id}"}
                        if assertion.supersedes_assertion_id is not None
                        else None
                    ),
                    "cg:graphRevisionId": str(assertion.graph_revision_id),
                    "cg:sourceSpan": [
                        {"@id": f"cg-resource:{source_id}"}
                        for source_id in sorted(assertion.source_span_ids, key=str)
                    ],
                }
            )
        return {
            "@context": {
                "cg": str(CG),
                "cg-resource": str(CG_RESOURCE),
                "xsd": str(XSD),
            },
            "@graph": graph_items,
        }

    def export_turtle(self, snapshot: GraphSnapshot) -> str:
        graph = self.to_rdf_graph(snapshot)
        serialized = graph.serialize(format="turtle")
        return serialized.decode("utf-8") if isinstance(serialized, bytes) else serialized

    def export(
        self, snapshot: GraphSnapshot, format_: Literal["cytoscape", "jsonld", "turtle"]
    ) -> JsonObject | str:
        if format_ == "cytoscape":
            return self.export_cytoscape(snapshot)
        if format_ == "jsonld":
            return self.export_jsonld(snapshot)
        return self.export_turtle(snapshot)

    def to_rdf_graph(self, snapshot: GraphSnapshot) -> Graph:
        graph = Graph()
        graph.bind("cg", CG)
        graph.bind("cgr", CG_RESOURCE)
        for relation_type in snapshot.relation_types:
            subject = CG_RESOURCE[str(relation_type.id)]
            graph.add((subject, RDF.type, CG.RelationType))
            graph.add((subject, CG.name, RdfLiteral(relation_type.name.value)))
            graph.add((subject, CG.description, RdfLiteral(relation_type.description)))
            for domain_type in relation_type.domain_types:
                graph.add((subject, CG.domainType, CG[domain_type.value]))
            for range_type in relation_type.range_types:
                graph.add((subject, CG.rangeType, CG[range_type.value]))
            graph.add((subject, CG.symmetric, RdfLiteral(relation_type.symmetric)))
            graph.add((subject, CG.transitive, RdfLiteral(relation_type.transitive)))
            graph.add((subject, CG.temporal, RdfLiteral(relation_type.temporal)))
        for node in snapshot.nodes:
            subject = CG_RESOURCE[str(node.id)]
            graph.add((subject, RDF.type, CG[node.node_type.value]))
            graph.add((subject, CG.workspaceId, RdfLiteral(str(node.workspace_id))))
            graph.add((subject, CG.epistemicStatus, RdfLiteral(node.epistemic_status.value)))
            graph.add(
                (
                    subject,
                    CG.sourceConfidence,
                    RdfLiteral(node.source_confidence, datatype=XSD.decimal),
                )
            )
            graph.add((subject, CG.createdBy, RdfLiteral(node.created_by)))
            if node.model_run_id is not None:
                graph.add((subject, CG.modelRun, CG_RESOURCE[str(node.model_run_id)]))
            graph.add((subject, CG.graphRevisionId, RdfLiteral(str(node.graph_revision_id))))
            for source_id in node.source_span_ids:
                graph.add((subject, CG.sourceSpan, CG_RESOURCE[str(source_id)]))
            for key, value in node.properties.items():
                _add_property(graph, subject, key, value)
        for assertion in snapshot.assertions:
            assertion_uri = CG_RESOURCE[str(assertion.id)]
            graph.add((assertion_uri, RDF.type, CG.RelationAssertion))
            graph.add((assertion_uri, CG.subject, CG_RESOURCE[str(assertion.subject_id)]))
            graph.add((assertion_uri, CG.object, CG_RESOURCE[str(assertion.object_id)]))
            graph.add((assertion_uri, CG.predicate, RdfLiteral(assertion.predicate_key.value)))
            graph.add(
                (
                    assertion_uri,
                    CG.description,
                    RdfLiteral(assertion.natural_language_description),
                )
            )
            graph.add(
                (
                    assertion_uri,
                    CG.confidence,
                    RdfLiteral(assertion.confidence, datatype=XSD.decimal),
                )
            )
            graph.add(
                (assertion_uri, CG.epistemicStatus, RdfLiteral(assertion.epistemic_status.value))
            )
            graph.add(
                (
                    assertion_uri,
                    CG.graphRevisionId,
                    RdfLiteral(str(assertion.graph_revision_id)),
                )
            )
            if assertion.model_run_id is not None:
                graph.add((assertion_uri, CG.modelRun, CG_RESOURCE[str(assertion.model_run_id)]))
            graph.add((assertion_uri, CG.createdBy, RdfLiteral(assertion.created_by)))
            graph.add(
                (
                    assertion_uri,
                    CG.createdAt,
                    RdfLiteral(assertion.created_at.isoformat(), datatype=XSD.dateTime),
                )
            )
            graph.add(
                (
                    assertion_uri,
                    CG.validFrom,
                    RdfLiteral(assertion.valid_from.isoformat(), datatype=XSD.dateTime),
                )
            )
            if assertion.valid_to is not None:
                graph.add(
                    (
                        assertion_uri,
                        CG.validTo,
                        RdfLiteral(assertion.valid_to.isoformat(), datatype=XSD.dateTime),
                    )
                )
            if assertion.superseded_at is not None:
                graph.add(
                    (
                        assertion_uri,
                        CG.supersededAt,
                        RdfLiteral(
                            assertion.superseded_at.isoformat(),
                            datatype=XSD.dateTime,
                        ),
                    )
                )
            if assertion.relation_type_id is not None:
                graph.add(
                    (
                        assertion_uri,
                        CG.relationType,
                        CG_RESOURCE[str(assertion.relation_type_id)],
                    )
                )
            if assertion.supersedes_assertion_id is not None:
                graph.add(
                    (
                        assertion_uri,
                        CG.supersedes,
                        CG_RESOURCE[str(assertion.supersedes_assertion_id)],
                    )
                )
            for source_id in assertion.source_span_ids:
                graph.add((assertion_uri, CG.sourceSpan, CG_RESOURCE[str(source_id)]))
            graph.add(
                (assertion_uri, CG.instanceOf, CG[f"RelationType/{assertion.predicate_key.value}"])
            )
        return graph


def _node_label(node: GraphNode) -> str:
    for key in ("display_name", "canonical_name", "name", "title"):
        value = node.properties.get(key)
        if isinstance(value, str) and value:
            return value
    return str(node.id)


def _add_property(graph: Graph, subject: URIRef, key: str, value: JsonValue) -> None:
    predicate = CG[f"property/{key}"]
    if isinstance(value, list):
        for item in value:
            _add_property(graph, subject, key, item)
        return
    if isinstance(value, dict):
        graph.add((subject, predicate, RdfLiteral(str(value))))
        return
    if value is not None:
        graph.add((subject, predicate, RdfLiteral(value)))
