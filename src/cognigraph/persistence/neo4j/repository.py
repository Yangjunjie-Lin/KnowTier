"""Asynchronous Neo4j semantic graph projection repository."""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, cast

from neo4j import AsyncDriver, AsyncGraphDatabase, AsyncManagedTransaction
from neo4j.exceptions import Neo4jError

from .errors import (
    GraphPayloadError,
    GraphRevisionConflict,
    GraphUnavailableError,
)
from .models import GraphApplyResult, GraphDeltaInput, GraphRecord
from .ordering import topological_knowledge_points
from .payload import NormalizedDelta, decode_neo4j_properties, neo4j_properties, normalize_delta
from .schema import SCHEMA_QUERIES

_MAX_LIMIT = 500
_MAX_DEPTH = 5


class Neo4jGraphRepository:
    """Neo4j 5.x projection with fixed, parameterized Cypher statements."""

    def __init__(self, driver: AsyncDriver, *, database: str = "neo4j") -> None:
        self._driver = driver
        self._database = database
        self._closed = False

    @classmethod
    def from_uri(
        cls,
        uri: str,
        username: str,
        password: str,
        *,
        database: str = "neo4j",
        connection_timeout: float = 5.0,
    ) -> Neo4jGraphRepository:
        driver = AsyncGraphDatabase.driver(
            uri,
            auth=(username, password),
            connection_timeout=connection_timeout,
        )
        return cls(driver, database=database)

    async def __aenter__(self) -> Neo4jGraphRepository:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: object | None,
    ) -> None:
        await self.close()

    async def close(self) -> None:
        if not self._closed:
            await self._driver.close()
            self._closed = True

    async def is_ready(self) -> bool:
        if self._closed:
            return False
        try:
            await self._driver.verify_connectivity()
            async with self._driver.session(database=self._database) as session:
                result = await session.run("RETURN 1 AS ready")
                record = await result.single(strict=True)
                ready: bool = record["ready"] == 1
                return ready
        except (Neo4jError, OSError, TimeoutError):
            return False

    async def create_schema(self) -> None:
        self._ensure_open()
        try:
            async with self._driver.session(database=self._database) as session:
                for query in SCHEMA_QUERIES:
                    result = await session.run(query)
                    await result.consume()
        except Neo4jError as exc:
            raise GraphUnavailableError("failed to initialize Neo4j schema") from exc

    async def apply_delta(
        self,
        delta: GraphDeltaInput,
        revision_id: str | None = None,
        *,
        application_id: str | None = None,
    ) -> GraphApplyResult:
        """Apply a validated delta atomically and idempotently.

        ``revision_id`` is normally the PostgreSQL GraphRevision identifier. If it
        is omitted, a deterministic content hash is used, which also makes local
        and test projections idempotent.
        """

        self._ensure_open()
        normalized = normalize_delta(delta)
        resolved_revision_id = _clean_identifier(
            revision_id
            or _mapping_text(normalized.raw, "revision_id")
            or _mapping_text(normalized.raw, "graph_revision_id")
            or _mapping_text(normalized.raw, "id")
            or application_id
            or normalized.deterministic_revision_id(),
            "revision_id",
        )
        resolved_application_id = _clean_identifier(
            application_id or resolved_revision_id, "application_id"
        )
        try:
            async with self._driver.session(database=self._database) as session:
                return cast(
                    GraphApplyResult,
                    await session.execute_write(
                        self._apply_delta_transaction,
                        normalized,
                        resolved_revision_id,
                        resolved_application_id,
                    ),
                )
        except (GraphPayloadError, GraphRevisionConflict):
            raise
        except Neo4jError as exc:
            raise GraphUnavailableError("failed to apply graph delta") from exc

    @staticmethod
    async def _apply_delta_transaction(
        tx: AsyncManagedTransaction,
        delta: NormalizedDelta,
        revision_id: str,
        application_id: str,
    ) -> GraphApplyResult:
        workspace_id = delta.workspace_id
        now = datetime.now(UTC).isoformat()

        lock_result = await tx.run(
            """
            MERGE (state:WorkspaceGraphState {workspace_id: $workspace_id})
            ON CREATE SET state.current_revision_id = null, state.created_at = $now
            SET state.lock_token = $application_id
            RETURN state.current_revision_id AS current_revision_id
            """,
            workspace_id=workspace_id,
            application_id=application_id,
            now=now,
        )
        state = await lock_result.single(strict=True)

        applied_result = await tx.run(
            """
            MATCH (graph_apply:GraphApply {
                workspace_id: $workspace_id,
                revision_id: $revision_id,
                status: 'APPLIED'
            })
            RETURN graph_apply
            """,
            workspace_id=workspace_id,
            revision_id=revision_id,
        )
        existing = await applied_result.single()
        if existing is not None:
            properties = decode_neo4j_properties(existing["graph_apply"])
            return _apply_result_from_properties(properties, already_applied=True)

        current_revision = state["current_revision_id"]
        if current_revision != delta.base_revision_id:
            raise GraphRevisionConflict(delta.base_revision_id, current_revision)

        await _validate_new_identifiers(tx, workspace_id, delta)
        await _validate_existing_node_patches(tx, workspace_id, delta.update_nodes)
        await _validate_assertion_endpoints(tx, workspace_id, delta)
        await _validate_source_spans(tx, workspace_id, delta)
        await _validate_supersede_targets(tx, workspace_id, delta)
        await _validate_provenance_targets(tx, workspace_id, delta)

        if delta.add_nodes:
            result = await tx.run(
                """
                UNWIND $nodes AS item
                MERGE (node:GraphNode {workspace_id: $workspace_id, id: item.id})
                ON CREATE SET node.created_at = $now
                SET node += item.properties,
                    node.entity_type = item.entity_type,
                    node.graph_revision_id = $revision_id,
                    node.updated_at = $now
                FOREACH (_ IN CASE WHEN item.entity_type = 'RelationType' THEN [1] ELSE [] END |
                    SET node:RelationType
                )
                """,
                workspace_id=workspace_id,
                nodes=[_neo4j_node(item) for item in delta.add_nodes],
                revision_id=revision_id,
                now=now,
            )
            await result.consume()

        if delta.update_nodes:
            result = await tx.run(
                """
                UNWIND $patches AS item
                MATCH (node:GraphNode {workspace_id: $workspace_id, id: item.id})
                SET node += item.properties,
                    node.graph_revision_id = $revision_id,
                    node.updated_at = $now
                """,
                workspace_id=workspace_id,
                patches=[_neo4j_patch(item) for item in delta.update_nodes],
                revision_id=revision_id,
                now=now,
            )
            await result.consume()

        node_provenance = [
            {"target_id": item["id"], "source_span_id": source_id}
            for item in (*delta.add_nodes, *delta.update_nodes)
            for source_id in item["source_span_ids"]
        ]
        if node_provenance:
            result = await tx.run(
                """
                UNWIND $links AS item
                MATCH (target:GraphNode {workspace_id: $workspace_id, id: item.target_id})
                MATCH (source:GraphNode {
                    workspace_id: $workspace_id,
                    id: item.source_span_id,
                    entity_type: 'SourceSpan'
                })
                MERGE (target)-[:SUPPORTED_BY]->(source)
                """,
                workspace_id=workspace_id,
                links=node_provenance,
            )
            await result.consume()

        if delta.add_assertions:
            result = await tx.run(
                """
                UNWIND $assertions AS item
                MATCH (subject:GraphNode {workspace_id: $workspace_id, id: item.subject_id})
                MATCH (object:GraphNode {workspace_id: $workspace_id, id: item.object_id})
                MERGE (relation_type:RelationType {
                    workspace_id: $workspace_id,
                    name: item.predicate_key
                })
                ON CREATE SET relation_type.created_at = $now
                MERGE (assertion:RelationAssertion {
                    workspace_id: $workspace_id,
                    id: item.id
                })
                ON CREATE SET assertion.created_at = $now
                SET assertion += item.properties,
                    assertion.predicate_key = item.predicate_key,
                    assertion.relation_type_id = item.relation_type_id,
                    assertion.graph_revision_id = $revision_id,
                    assertion.updated_at = $now
                MERGE (subject)-[:SUBJECT_OF]->(assertion)
                MERGE (assertion)-[:OBJECT_IS]->(object)
                MERGE (assertion)-[:INSTANCE_OF]->(relation_type)
                """,
                workspace_id=workspace_id,
                assertions=[_neo4j_assertion(item) for item in delta.add_assertions],
                revision_id=revision_id,
                now=now,
            )
            await result.consume()

            direct_provenance = [
                {"target_id": item["id"], "source_span_id": source_id}
                for item in delta.add_assertions
                for source_id in item["source_span_ids"]
            ]
            if direct_provenance:
                result = await tx.run(
                    """
                    UNWIND $links AS item
                    MATCH (target:RelationAssertion {
                        workspace_id: $workspace_id,
                        id: item.target_id
                    })
                    MATCH (source:GraphNode {
                        workspace_id: $workspace_id,
                        id: item.source_span_id,
                        entity_type: 'SourceSpan'
                    })
                    MERGE (target)-[:SUPPORTED_BY]->(source)
                    """,
                    workspace_id=workspace_id,
                    links=direct_provenance,
                )
                await result.consume()

        if delta.supersede_assertions:
            supersedes = [
                {
                    **item,
                    "superseded_at": item["superseded_at"] or now,
                    "valid_to": item["valid_to"] or now,
                }
                for item in delta.supersede_assertions
            ]
            result = await tx.run(
                """
                UNWIND $supersedes AS item
                MATCH (old:RelationAssertion {workspace_id: $workspace_id, id: item.id})
                SET old.superseded_at = item.superseded_at,
                    old.valid_to = item.valid_to,
                    old.graph_revision_id = $revision_id,
                    old.updated_at = $now
                WITH old, item
                OPTIONAL MATCH (replacement:RelationAssertion {
                    workspace_id: $workspace_id,
                    id: item.superseded_by_id
                })
                FOREACH (_ IN CASE WHEN replacement IS NULL THEN [] ELSE [1] END |
                    MERGE (replacement)-[:SUPERSEDES]->(old)
                )
                """,
                workspace_id=workspace_id,
                supersedes=supersedes,
                revision_id=revision_id,
                now=now,
            )
            await result.consume()

        if delta.add_provenance_links:
            node_links = [
                item
                for item in delta.add_provenance_links
                if item["target_kind"] in {"node", "any"}
            ]
            assertion_links = [
                item
                for item in delta.add_provenance_links
                if item["target_kind"] in {"assertion", "any"}
            ]
            if node_links:
                result = await tx.run(
                    """
                    UNWIND $links AS item
                    MATCH (target:GraphNode {workspace_id: $workspace_id, id: item.target_id})
                    MATCH (source:GraphNode {
                        workspace_id: $workspace_id,
                        id: item.source_span_id,
                        entity_type: 'SourceSpan'
                    })
                    MERGE (target)-[:SUPPORTED_BY]->(source)
                    """,
                    workspace_id=workspace_id,
                    links=node_links,
                )
                await result.consume()
            if assertion_links:
                result = await tx.run(
                    """
                    UNWIND $links AS item
                    MATCH (target:RelationAssertion {
                        workspace_id: $workspace_id,
                        id: item.target_id
                    })
                    MATCH (source:GraphNode {
                        workspace_id: $workspace_id,
                        id: item.source_span_id,
                        entity_type: 'SourceSpan'
                    })
                    MERGE (target)-[:SUPPORTED_BY]->(source)
                    """,
                    workspace_id=workspace_id,
                    links=assertion_links,
                )
                await result.consume()

        await _record_candidates(
            tx,
            workspace_id,
            revision_id,
            now,
            "MergeCandidate",
            delta.merge_candidates,
        )
        await _record_candidates(
            tx,
            workspace_id,
            revision_id,
            now,
            "ConflictSet",
            delta.conflicts,
        )

        summary = GraphApplyResult(
            workspace_id=workspace_id,
            revision_id=revision_id,
            nodes_added=len(delta.add_nodes),
            nodes_updated=len(delta.update_nodes),
            assertions_added=len(delta.add_assertions),
            assertions_superseded=len(delta.supersede_assertions),
            provenance_links_added=(
                len(delta.add_provenance_links)
                + sum(len(item["source_span_ids"]) for item in delta.add_assertions)
                + sum(
                    len(item["source_span_ids"]) for item in (*delta.add_nodes, *delta.update_nodes)
                )
            ),
            merge_candidates_recorded=len(delta.merge_candidates),
            conflicts_recorded=len(delta.conflicts),
        )
        result = await tx.run(
            """
            MERGE (revision:GraphRevisionProjection {
                workspace_id: $workspace_id,
                id: $revision_id
            })
            ON CREATE SET revision.created_at = $now
            SET revision.base_revision_id = $base_revision_id,
                revision.generated_by_model_run_id = $model_run_id,
                revision.applied_at = $now
            WITH revision
            MATCH (state:WorkspaceGraphState {workspace_id: $workspace_id})
            SET state.current_revision_id = $revision_id,
                state.updated_at = $now
            MERGE (graph_apply:GraphApply {
                workspace_id: $workspace_id,
                revision_id: $revision_id
            })
            SET graph_apply += $summary,
                graph_apply.application_id = $application_id,
                graph_apply.status = 'APPLIED',
                graph_apply.applied_at = $now
            """,
            workspace_id=workspace_id,
            revision_id=revision_id,
            base_revision_id=delta.base_revision_id,
            model_run_id=delta.generated_by_model_run_id,
            application_id=application_id,
            now=now,
            summary=summary.to_dict(),
        )
        await result.consume()
        return summary

    async def search_knowledge_points(
        self, workspace_id: str, query: str, *, limit: int = 20
    ) -> GraphRecord:
        workspace = _clean_identifier(workspace_id, "workspace_id")
        bounded_limit = _bounded_limit(limit)
        normalized_query = query.strip().lower()
        async with self._driver.session(database=self._database) as session:
            result = await session.run(
                """
                MATCH (node:GraphNode {
                    workspace_id: $workspace_id,
                    entity_type: 'KnowledgePoint'
                })
                WHERE $search_text = ''
                   OR toLower(coalesce(node.canonical_name, '')) CONTAINS $search_text
                   OR toLower(coalesce(node.display_name, '')) CONTAINS $search_text
                   OR toLower(coalesce(node.summary, '')) CONTAINS $search_text
                RETURN properties(node) AS node
                ORDER BY coalesce(node.canonical_name, node.display_name, node.id)
                LIMIT $limit
                """,
                workspace_id=workspace,
                search_text=normalized_query,
                limit=bounded_limit,
            )
            records = [decode_neo4j_properties(record["node"]) async for record in result]
        return await self._versioned(workspace, {"nodes": records})

    async def get_graph_manifest(self, workspace_id: str) -> GraphRecord:
        workspace = _clean_identifier(workspace_id, "workspace_id")
        async with self._driver.session(database=self._database) as session:
            result = await session.run(
                """
                OPTIONAL MATCH (node:GraphNode {workspace_id: $workspace_id})
                WITH count(node) AS node_count,
                     count(CASE WHEN node.entity_type = 'KnowledgePoint' THEN 1 END)
                         AS knowledge_point_count,
                     count(CASE WHEN node.entity_type = 'SourceDocument' THEN 1 END)
                         AS source_count,
                     collect(DISTINCT node.entity_type) AS entity_types,
                     collect(DISTINCT CASE WHEN node.entity_type = 'Domain'
                         THEN coalesce(node.name, node.display_name, node.canonical_name) END)
                         AS domains,
                     collect(DISTINCT CASE WHEN node.entity_type = 'Theory'
                         THEN coalesce(node.name, node.display_name, node.canonical_name) END)
                         AS theories,
                     collect(CASE WHEN node.entity_type = 'KnowledgePoint'
                         THEN node.domain END) AS knowledge_domains
                OPTIONAL MATCH (assertion:RelationAssertion {workspace_id: $workspace_id})
                WITH node_count, knowledge_point_count, source_count, entity_types,
                     domains, theories, knowledge_domains,
                     count(assertion) AS assertion_count,
                     collect(DISTINCT assertion.predicate_key) AS relation_types
                OPTIONAL MATCH (state:WorkspaceGraphState {workspace_id: $workspace_id})
                RETURN node_count, knowledge_point_count, source_count, entity_types,
                       domains, theories, knowledge_domains,
                       assertion_count, relation_types, state.current_revision_id AS revision_id,
                       state.updated_at AS updated_at
                """,
                workspace_id=workspace,
            )
            record = await result.single(strict=True)
        return {
            "workspace_id": workspace,
            "revision_id": record["revision_id"],
            "ontology": {
                "entity_types": sorted(item for item in record["entity_types"] if item),
                "relation_types": sorted(item for item in record["relation_types"] if item),
            },
            "top_level_domains": sorted(item for item in record["domains"] if item),
            "theories": sorted(item for item in record["theories"] if item),
            "knowledge_point_count": record["knowledge_point_count"],
            "assertion_count": record["assertion_count"],
            "source_count": record["source_count"],
            "node_count": record["node_count"],
            "major_clusters": [
                {"name": name, "node_count": count}
                for name, count in sorted(
                    Counter(str(item) for item in record["knowledge_domains"] if item).items(),
                    key=lambda item: (-item[1], item[0]),
                )[:10]
            ],
            "updated_at": _json_scalar(record["updated_at"]),
        }

    async def get_node_detail(self, workspace_id: str, node_id: str) -> GraphRecord | None:
        workspace = _clean_identifier(workspace_id, "workspace_id")
        identifier = _clean_identifier(node_id, "node_id")
        async with self._driver.session(database=self._database) as session:
            return cast(
                GraphRecord | None,
                await session.execute_read(self._read_node_detail, workspace, identifier),
            )

    @staticmethod
    async def _read_node_detail(
        tx: AsyncManagedTransaction, workspace_id: str, node_id: str
    ) -> GraphRecord | None:
        node_result = await tx.run(
            """
            MATCH (node:GraphNode {workspace_id: $workspace_id, id: $node_id})
            RETURN properties(node) AS node
            """,
            workspace_id=workspace_id,
            node_id=node_id,
        )
        node_record = await node_result.single()
        if node_record is None:
            return None
        outgoing, incoming = await _read_incident_assertions(tx, workspace_id, node_id, 200)
        sources = await _read_sources(tx, workspace_id, node_id, 100)
        revision_id = await _read_revision(tx, workspace_id)
        node = decode_neo4j_properties(node_record["node"])
        return {
            "node": node,
            **_node_detail_facets(node, outgoing, incoming),
            "outgoing_assertions": outgoing,
            "incoming_assertions": incoming,
            "sources": sources,
            "revision_id": revision_id,
        }

    async def get_relation_assertion_detail(
        self, workspace_id: str, assertion_id: str
    ) -> GraphRecord | None:
        workspace = _clean_identifier(workspace_id, "workspace_id")
        identifier = _clean_identifier(assertion_id, "assertion_id")
        async with self._driver.session(database=self._database) as session:
            return cast(
                GraphRecord | None,
                await session.execute_read(self._read_assertion_detail, workspace, identifier),
            )

    @staticmethod
    async def _read_assertion_detail(
        tx: AsyncManagedTransaction, workspace_id: str, assertion_id: str
    ) -> GraphRecord | None:
        result = await tx.run(
            """
            MATCH (subject:GraphNode {workspace_id: $workspace_id})
                  -[:SUBJECT_OF]->(assertion:RelationAssertion {
                      workspace_id: $workspace_id,
                      id: $assertion_id
                  })-[:OBJECT_IS]->(object:GraphNode {workspace_id: $workspace_id})
            OPTIONAL MATCH (assertion)-[:INSTANCE_OF]->(relation_type:RelationType)
            OPTIONAL MATCH (replacement:RelationAssertion)-[:SUPERSEDES]->(assertion)
            OPTIONAL MATCH (assertion)-[:SUPERSEDES]->(superseded:RelationAssertion)
            OPTIONAL MATCH (conflict:ConflictSet {workspace_id: $workspace_id})
            WHERE $assertion_id IN coalesce(conflict.assertion_ids, [])
            RETURN properties(assertion) AS assertion,
                   properties(subject) AS subject,
                   properties(object) AS object,
                   properties(relation_type) AS relation_type,
                   collect(DISTINCT properties(replacement)) AS replacements,
                   collect(DISTINCT properties(superseded)) AS superseded_assertions,
                   collect(DISTINCT properties(conflict)) AS conflicts
            """,
            workspace_id=workspace_id,
            assertion_id=assertion_id,
        )
        record = await result.single()
        if record is None:
            return None
        sources = await _read_sources(tx, workspace_id, assertion_id, 100)
        revision_id = await _read_revision(tx, workspace_id)
        return {
            "assertion": decode_neo4j_properties(record["assertion"]),
            "subject": decode_neo4j_properties(record["subject"]),
            "object": decode_neo4j_properties(record["object"]),
            "relation_type": decode_neo4j_properties(record["relation_type"] or {}),
            "replacements": [
                decode_neo4j_properties(item) for item in record["replacements"] if item
            ],
            "superseded_assertions": [
                decode_neo4j_properties(item) for item in record["superseded_assertions"] if item
            ],
            "conflicts": [decode_neo4j_properties(item) for item in record["conflicts"] if item],
            "sources": sources,
            "revision_id": revision_id,
        }

    async def get_prerequisite_chain(
        self, workspace_id: str, node_id: str, *, max_depth: int = 3, limit: int = 100
    ) -> GraphRecord:
        return await self._walk_subgraph(
            workspace_id,
            [node_id],
            predicates=("REQUIRES",),
            direction="outgoing",
            max_depth=max_depth,
            max_nodes=limit,
        )

    async def get_related_theories(
        self, workspace_id: str, node_id: str, *, limit: int = 20
    ) -> GraphRecord:
        workspace = _clean_identifier(workspace_id, "workspace_id")
        identifier = _clean_identifier(node_id, "node_id")
        bounded_limit = _bounded_limit(limit)
        async with self._driver.session(database=self._database) as session:
            result = await session.run(
                """
                MATCH (focus:GraphNode {workspace_id: $workspace_id, id: $node_id})
                MATCH (left:GraphNode)-[:SUBJECT_OF]->(assertion:RelationAssertion)
                      -[:OBJECT_IS]->(right:GraphNode)
                WHERE assertion.workspace_id = $workspace_id
                  AND (left = focus OR right = focus)
                  AND (left.entity_type = 'Theory' OR right.entity_type = 'Theory')
                WITH assertion, CASE WHEN left = focus THEN right ELSE left END AS theory
                RETURN DISTINCT properties(theory) AS theory,
                       properties(assertion) AS assertion
                ORDER BY coalesce(theory.canonical_name, theory.display_name, theory.id)
                LIMIT $limit
                """,
                workspace_id=workspace,
                node_id=identifier,
                limit=bounded_limit,
            )
            theories = [
                {
                    "theory": decode_neo4j_properties(record["theory"]),
                    "assertion": decode_neo4j_properties(record["assertion"]),
                }
                async for record in result
            ]
        return await self._versioned(workspace, {"theories": theories})

    async def get_learning_path(
        self,
        workspace_id: str,
        target_node_id: str,
        *,
        learner_id: str | None = None,
        max_depth: int = 3,
        limit: int = 100,
    ) -> GraphRecord:
        path = await self.get_prerequisite_chain(
            workspace_id, target_node_id, max_depth=max_depth, limit=limit
        )
        path["knowledge_point_ids"] = topological_knowledge_points(path)
        if learner_id is not None:
            node_ids = [str(node["id"]) for node in path["nodes"] if "id" in node]
            path["learner_state"] = (
                await self.get_learner_state(
                    workspace_id,
                    learner_id,
                    knowledge_point_ids=node_ids,
                    limit=limit,
                )
            )["states"]
        return path

    async def get_learner_state(
        self,
        workspace_id: str,
        learner_id: str,
        *,
        knowledge_point_ids: Sequence[str] = (),
        limit: int = 100,
    ) -> GraphRecord:
        workspace = _clean_identifier(workspace_id, "workspace_id")
        learner = _clean_identifier(learner_id, "learner_id")
        identifiers = [
            _clean_identifier(value, "knowledge_point_id") for value in knowledge_point_ids
        ]
        bounded_limit = _bounded_limit(limit)
        async with self._driver.session(database=self._database) as session:
            result = await session.run(
                """
                MATCH (state:GraphNode {
                    workspace_id: $workspace_id,
                    entity_type: 'LearnerKnowledgeState'
                })
                WHERE state.learner_id = $learner_id
                  AND (size($knowledge_point_ids) = 0
                       OR state.knowledge_point_id IN $knowledge_point_ids)
                RETURN properties(state) AS state
                ORDER BY state.knowledge_point_id
                LIMIT $limit
                """,
                workspace_id=workspace,
                learner_id=learner,
                knowledge_point_ids=identifiers,
                limit=bounded_limit,
            )
            states = [decode_neo4j_properties(record["state"]) async for record in result]
        return await self._versioned(workspace, {"learner_id": learner, "states": states})

    async def get_supporting_sources(
        self, workspace_id: str, entity_id: str, *, limit: int = 20
    ) -> GraphRecord:
        workspace = _clean_identifier(workspace_id, "workspace_id")
        identifier = _clean_identifier(entity_id, "entity_id")
        bounded_limit = _bounded_limit(limit)
        async with self._driver.session(database=self._database) as session:
            sources = await session.execute_read(
                _read_sources, workspace, identifier, bounded_limit
            )
        return await self._versioned(workspace, {"entity_id": identifier, "sources": sources})

    async def get_focus_subgraph(
        self,
        workspace_id: str,
        node_ids: Sequence[str],
        *,
        max_depth: int = 2,
        max_nodes: int = 100,
    ) -> GraphRecord:
        return await self._walk_subgraph(
            workspace_id,
            node_ids,
            predicates=(),
            direction="both",
            max_depth=max_depth,
            max_nodes=max_nodes,
        )

    async def _walk_subgraph(
        self,
        workspace_id: str,
        node_ids: Sequence[str],
        *,
        predicates: Sequence[str],
        direction: str,
        max_depth: int,
        max_nodes: int,
    ) -> GraphRecord:
        workspace = _clean_identifier(workspace_id, "workspace_id")
        depth = _bounded_depth(max_depth)
        bounded_nodes = _bounded_limit(max_nodes)
        roots = list(dict.fromkeys(_clean_identifier(value, "node_id") for value in node_ids))
        if not roots:
            return await self._versioned(workspace, {"nodes": [], "assertions": []})
        async with self._driver.session(database=self._database) as session:
            nodes, assertions = await session.execute_read(
                _read_walk,
                workspace,
                roots,
                list(predicates),
                direction,
                depth,
                bounded_nodes,
            )
        return await self._versioned(workspace, {"nodes": nodes, "assertions": assertions})

    async def _versioned(self, workspace_id: str, payload: GraphRecord) -> GraphRecord:
        async with self._driver.session(database=self._database) as session:
            result = await session.run(
                """
                OPTIONAL MATCH (state:WorkspaceGraphState {workspace_id: $workspace_id})
                RETURN state.current_revision_id AS revision_id
                """,
                workspace_id=workspace_id,
            )
            record = await result.single(strict=True)
        return {"workspace_id": workspace_id, "revision_id": record["revision_id"], **payload}

    def _ensure_open(self) -> None:
        if self._closed:
            raise GraphUnavailableError("Neo4j repository is closed")


async def _validate_existing_node_patches(
    tx: AsyncManagedTransaction, workspace_id: str, patches: Sequence[GraphRecord]
) -> None:
    if not patches:
        return
    result = await tx.run(
        """
        UNWIND $patches AS item
        OPTIONAL MATCH (node:GraphNode {workspace_id: $workspace_id, id: item.id})
        RETURN collect(CASE WHEN node IS NULL THEN item.id END) AS missing,
               collect(CASE
                   WHEN item.expected_revision_id IS NOT NULL
                    AND node.graph_revision_id <> item.expected_revision_id
                   THEN item.id
               END) AS stale
        """,
        workspace_id=workspace_id,
        patches=[
            {"id": item["id"], "expected_revision_id": item["expected_revision_id"]}
            for item in patches
        ],
    )
    record = await result.single(strict=True)
    if record["missing"]:
        raise GraphPayloadError(f"cannot patch missing graph nodes: {record['missing']!r}")
    if record["stale"]:
        raise GraphRevisionConflict(
            next(
                str(item["expected_revision_id"])
                for item in patches
                if item["id"] in record["stale"]
            ),
            "one or more node revisions differ",
        )


async def _validate_new_identifiers(
    tx: AsyncManagedTransaction, workspace_id: str, delta: NormalizedDelta
) -> None:
    if delta.add_nodes:
        result = await tx.run(
            """
            MATCH (node:GraphNode {workspace_id: $workspace_id})
            WHERE node.id IN $ids
            RETURN collect(node.id) AS existing
            """,
            workspace_id=workspace_id,
            ids=[item["id"] for item in delta.add_nodes],
        )
        record = await result.single(strict=True)
        if record["existing"]:
            raise GraphPayloadError(f"graph nodes already exist: {record['existing']!r}")
    if delta.add_assertions:
        result = await tx.run(
            """
            MATCH (assertion:RelationAssertion {workspace_id: $workspace_id})
            WHERE assertion.id IN $ids
            RETURN collect(assertion.id) AS existing
            """,
            workspace_id=workspace_id,
            ids=[item["id"] for item in delta.add_assertions],
        )
        record = await result.single(strict=True)
        if record["existing"]:
            raise GraphPayloadError(f"relation assertions already exist: {record['existing']!r}")


async def _validate_assertion_endpoints(
    tx: AsyncManagedTransaction, workspace_id: str, delta: NormalizedDelta
) -> None:
    identifiers = {
        str(item[key]) for item in delta.add_assertions for key in ("subject_id", "object_id")
    }
    if not identifiers:
        return
    pending_ids = {str(item["id"]) for item in delta.add_nodes}
    lookup_ids = sorted(identifiers - pending_ids)
    if not lookup_ids:
        return
    result = await tx.run(
        """
        UNWIND $ids AS id
        OPTIONAL MATCH (node:GraphNode {workspace_id: $workspace_id, id: id})
        WITH id, node WHERE node IS NULL
        RETURN collect(id) AS missing
        """,
        workspace_id=workspace_id,
        ids=lookup_ids,
    )
    record = await result.single(strict=True)
    if record["missing"]:
        raise GraphPayloadError(f"assertions reference missing graph nodes: {record['missing']!r}")


async def _validate_source_spans(
    tx: AsyncManagedTransaction, workspace_id: str, delta: NormalizedDelta
) -> None:
    source_ids = {
        str(source_id)
        for item in (*delta.add_nodes, *delta.update_nodes, *delta.add_assertions)
        for source_id in item["source_span_ids"]
    }
    source_ids.update(str(item["source_span_id"]) for item in delta.add_provenance_links)
    if not source_ids:
        return
    pending_types = {str(item["id"]): str(item["entity_type"]) for item in delta.add_nodes}
    invalid_pending = sorted(
        source_id
        for source_id in source_ids
        if source_id in pending_types and pending_types[source_id] != "SourceSpan"
    )
    if invalid_pending:
        raise GraphPayloadError(f"provenance sources are not SourceSpan nodes: {invalid_pending!r}")
    lookup_ids = sorted(source_ids - pending_types.keys())
    if not lookup_ids:
        return
    result = await tx.run(
        """
        UNWIND $ids AS id
        OPTIONAL MATCH (source:GraphNode {
            workspace_id: $workspace_id,
            id: id,
            entity_type: 'SourceSpan'
        })
        WITH id, source WHERE source IS NULL
        RETURN collect(id) AS missing
        """,
        workspace_id=workspace_id,
        ids=lookup_ids,
    )
    record = await result.single(strict=True)
    if record["missing"]:
        raise GraphPayloadError(f"missing source spans: {record['missing']!r}")


async def _validate_supersede_targets(
    tx: AsyncManagedTransaction, workspace_id: str, delta: NormalizedDelta
) -> None:
    if not delta.supersede_assertions:
        return
    pending_assertions = {str(item["id"]) for item in delta.add_assertions}
    identifiers = {
        str(item[key])
        for item in delta.supersede_assertions
        for key in ("id", "superseded_by_id")
        if item[key] is not None
    }
    lookup_ids = sorted(identifiers - pending_assertions)
    if not lookup_ids:
        return
    result = await tx.run(
        """
        UNWIND $ids AS id
        OPTIONAL MATCH (assertion:RelationAssertion {workspace_id: $workspace_id, id: id})
        WITH id, assertion WHERE assertion IS NULL
        RETURN collect(id) AS missing
        """,
        workspace_id=workspace_id,
        ids=lookup_ids,
    )
    record = await result.single(strict=True)
    if record["missing"]:
        raise GraphPayloadError(
            f"supersede operations reference missing assertions: {record['missing']!r}"
        )


async def _validate_provenance_targets(
    tx: AsyncManagedTransaction, workspace_id: str, delta: NormalizedDelta
) -> None:
    if not delta.add_provenance_links:
        return
    pending_nodes = {str(item["id"]) for item in delta.add_nodes}
    pending_assertions = {str(item["id"]) for item in delta.add_assertions}
    source_ids = {str(item["source_span_id"]) for item in delta.add_provenance_links}
    target_ids = {str(item["target_id"]) for item in delta.add_provenance_links}
    lookup_source_ids = sorted(source_ids - pending_nodes)
    lookup_target_ids = sorted(target_ids - pending_nodes - pending_assertions)
    if lookup_source_ids:
        result = await tx.run(
            """
            UNWIND $ids AS id
            OPTIONAL MATCH (source:GraphNode {
                workspace_id: $workspace_id,
                id: id,
                entity_type: 'SourceSpan'
            })
            WITH id, source WHERE source IS NULL
            RETURN collect(id) AS missing
            """,
            workspace_id=workspace_id,
            ids=lookup_source_ids,
        )
        record = await result.single(strict=True)
        if record["missing"]:
            raise GraphPayloadError(f"missing source spans: {record['missing']!r}")
    if lookup_target_ids:
        result = await tx.run(
            """
            UNWIND $ids AS id
            OPTIONAL MATCH (node:GraphNode {workspace_id: $workspace_id, id: id})
            OPTIONAL MATCH (assertion:RelationAssertion {workspace_id: $workspace_id, id: id})
            WITH id, node, assertion WHERE node IS NULL AND assertion IS NULL
            RETURN collect(id) AS missing
            """,
            workspace_id=workspace_id,
            ids=lookup_target_ids,
        )
        record = await result.single(strict=True)
        if record["missing"]:
            raise GraphPayloadError(f"missing provenance targets: {record['missing']!r}")


async def _record_candidates(
    tx: AsyncManagedTransaction,
    workspace_id: str,
    revision_id: str,
    now: str,
    label: str,
    candidates: Sequence[GraphRecord],
) -> None:
    if not candidates:
        return
    if label == "MergeCandidate":
        query = """
            UNWIND $candidates AS item
            MERGE (candidate:MergeCandidate {workspace_id: $workspace_id, id: item.id})
            ON CREATE SET candidate.created_at = $now
            SET candidate.payload_json = item.payload_json,
                candidate.graph_revision_id = $revision_id,
                candidate.status = 'PENDING'
        """
    elif label == "ConflictSet":
        query = """
            UNWIND $candidates AS item
            MERGE (candidate:ConflictSet {workspace_id: $workspace_id, id: item.id})
            ON CREATE SET candidate.created_at = $now
            SET candidate.payload_json = item.payload_json,
                candidate.assertion_ids = item.assertion_ids,
                candidate.graph_revision_id = $revision_id,
                candidate.status = 'PENDING'
        """
    else:
        raise GraphPayloadError("unsupported graph candidate type")
    result = await tx.run(
        query,
        workspace_id=workspace_id,
        revision_id=revision_id,
        now=now,
        candidates=[
            {
                "id": item["id"],
                "payload_json": neo4j_properties({"payload": item["payload"]})["payload"],
                "assertion_ids": _candidate_assertion_ids(item),
            }
            for item in candidates
        ],
    )
    await result.consume()


async def _read_incident_assertions(
    tx: AsyncManagedTransaction, workspace_id: str, node_id: str, limit: int
) -> tuple[list[GraphRecord], list[GraphRecord]]:
    outgoing_result = await tx.run(
        """
        MATCH (subject:GraphNode {workspace_id: $workspace_id, id: $node_id})
              -[:SUBJECT_OF]->(assertion:RelationAssertion)-[:OBJECT_IS]->(object:GraphNode)
        RETURN properties(assertion) AS assertion, properties(object) AS other
        ORDER BY assertion.id
        LIMIT $limit
        """,
        workspace_id=workspace_id,
        node_id=node_id,
        limit=limit,
    )
    outgoing = [
        {
            "assertion": decode_neo4j_properties(record["assertion"]),
            "object": decode_neo4j_properties(record["other"]),
        }
        async for record in outgoing_result
    ]
    incoming_result = await tx.run(
        """
        MATCH (subject:GraphNode)-[:SUBJECT_OF]->(assertion:RelationAssertion)
              -[:OBJECT_IS]->(object:GraphNode {workspace_id: $workspace_id, id: $node_id})
        RETURN properties(assertion) AS assertion, properties(subject) AS other
        ORDER BY assertion.id
        LIMIT $limit
        """,
        workspace_id=workspace_id,
        node_id=node_id,
        limit=limit,
    )
    incoming = [
        {
            "assertion": decode_neo4j_properties(record["assertion"]),
            "subject": decode_neo4j_properties(record["other"]),
        }
        async for record in incoming_result
    ]
    return outgoing, incoming


async def _read_sources(
    tx: AsyncManagedTransaction, workspace_id: str, entity_id: str, limit: int
) -> list[GraphRecord]:
    result = await tx.run(
        """
        MATCH (target)-[:SUPPORTED_BY]->(source:GraphNode {
            workspace_id: $workspace_id,
            entity_type: 'SourceSpan'
        })
        WHERE (target:GraphNode OR target:RelationAssertion)
          AND target.workspace_id = $workspace_id
          AND target.id = $entity_id
        OPTIONAL MATCH (document:GraphNode {
            workspace_id: $workspace_id,
            entity_type: 'SourceDocument'
        })
        WHERE document.id = source.document_id
        RETURN DISTINCT properties(source) AS source, properties(document) AS document
        ORDER BY source.document_id, source.page_number, source.start_offset, source.id
        LIMIT $limit
        """,
        workspace_id=workspace_id,
        entity_id=entity_id,
        limit=limit,
    )
    sources: list[GraphRecord] = []
    async for record in result:
        source = decode_neo4j_properties(record["source"])
        raw_document = record["document"]
        source["source_document"] = (
            decode_neo4j_properties(raw_document) if raw_document is not None else None
        )
        sources.append(source)
    return sources


async def _read_revision(tx: AsyncManagedTransaction, workspace_id: str) -> str | None:
    result = await tx.run(
        """
        OPTIONAL MATCH (state:WorkspaceGraphState {workspace_id: $workspace_id})
        RETURN state.current_revision_id AS revision_id
        """,
        workspace_id=workspace_id,
    )
    record = await result.single(strict=True)
    value = record["revision_id"]
    return str(value) if value is not None else None


async def _read_walk(
    tx: AsyncManagedTransaction,
    workspace_id: str,
    roots: list[str],
    predicates: list[str],
    direction: str,
    max_depth: int,
    max_nodes: int,
) -> tuple[list[GraphRecord], list[GraphRecord]]:
    root_result = await tx.run(
        """
        MATCH (node:GraphNode {workspace_id: $workspace_id})
        WHERE node.id IN $root_ids
        RETURN properties(node) AS node
        ORDER BY node.id
        LIMIT $limit
        """,
        workspace_id=workspace_id,
        root_ids=roots,
        limit=max_nodes,
    )
    nodes_by_id = {
        str(node["id"]): node
        async for record in root_result
        for node in [decode_neo4j_properties(record["node"])]
    }
    frontier = list(nodes_by_id)
    assertion_by_id: dict[str, GraphRecord] = {}
    for _ in range(max_depth):
        if not frontier or len(nodes_by_id) >= max_nodes:
            break
        result = await tx.run(
            """
            MATCH (left:GraphNode {workspace_id: $workspace_id})
                  -[:SUBJECT_OF]->(assertion:RelationAssertion {
                      workspace_id: $workspace_id
                  })-[:OBJECT_IS]->(right:GraphNode {workspace_id: $workspace_id})
            WHERE ($direction = 'both' AND (left.id IN $frontier OR right.id IN $frontier))
               OR ($direction = 'outgoing' AND left.id IN $frontier)
               OR ($direction = 'incoming' AND right.id IN $frontier)
            WITH left, assertion, right
            WHERE size($predicates) = 0 OR assertion.predicate_key IN $predicates
            RETURN properties(left) AS left,
                   properties(assertion) AS assertion,
                   properties(right) AS right
            ORDER BY assertion.id
            LIMIT $limit
            """,
            workspace_id=workspace_id,
            frontier=frontier,
            direction=direction,
            predicates=predicates,
            limit=max_nodes,
        )
        next_frontier: list[str] = []
        async for record in result:
            left = decode_neo4j_properties(record["left"])
            right = decode_neo4j_properties(record["right"])
            assertion = decode_neo4j_properties(record["assertion"])
            new_nodes = [node for node in (left, right) if str(node["id"]) not in nodes_by_id]
            if len(nodes_by_id) + len(new_nodes) > max_nodes:
                continue
            if str(assertion["id"]) not in assertion_by_id:
                assertion["subject_id"] = str(left["id"])
                assertion["object_id"] = str(right["id"])
                assertion_by_id[str(assertion["id"])] = assertion
            for node in (left, right):
                identifier = str(node["id"])
                if identifier not in nodes_by_id and len(nodes_by_id) < max_nodes:
                    nodes_by_id[identifier] = node
                    next_frontier.append(identifier)
        frontier = next_frontier
    return (
        [nodes_by_id[key] for key in sorted(nodes_by_id)],
        [assertion_by_id[key] for key in sorted(assertion_by_id)],
    )


def _node_detail_facets(
    node: GraphRecord,
    outgoing: list[GraphRecord],
    incoming: list[GraphRecord],
) -> GraphRecord:
    adjacent = [
        *(entry["object"] for entry in outgoing if isinstance(entry.get("object"), dict)),
        *(entry["subject"] for entry in incoming if isinstance(entry.get("subject"), dict)),
    ]
    theories = _unique_nodes(
        candidate for candidate in adjacent if candidate.get("entity_type") == "Theory"
    )
    related = _unique_nodes(
        candidate for candidate in adjacent if candidate.get("entity_type") == "KnowledgePoint"
    )
    prerequisites = _unique_nodes(
        entry["object"]
        for entry in outgoing
        if isinstance(entry.get("object"), dict)
        and isinstance(entry.get("assertion"), dict)
        and entry["assertion"].get("predicate_key") == "REQUIRES"
    )
    learning_stages = _unique_nodes(
        entry["subject"]
        for entry in incoming
        if isinstance(entry.get("subject"), dict)
        and entry["subject"].get("entity_type") == "LearningStage"
    )
    definition = next(
        (
            str(node[key])
            for key in ("plain_language_definition", "summary", "description")
            if node.get(key)
        ),
        None,
    )
    return {
        "natural_language_definition": definition,
        "theories": theories,
        "prerequisites": prerequisites,
        "related_knowledge_points": related,
        "learning_stages": learning_stages,
    }


def _unique_nodes(nodes: Iterable[GraphRecord]) -> list[GraphRecord]:
    by_id = {str(node.get("id")): node for node in nodes if node.get("id")}
    return [by_id[node_id] for node_id in sorted(by_id)]


def _candidate_assertion_ids(candidate: GraphRecord) -> list[str]:
    payload = candidate.get("payload")
    if not isinstance(payload, Mapping):
        return []
    assertion_ids = payload.get("assertion_ids")
    if not isinstance(assertion_ids, Sequence) or isinstance(assertion_ids, str | bytes):
        return []
    return [str(item) for item in assertion_ids]


def _neo4j_node(item: GraphRecord) -> GraphRecord:
    return {
        "id": item["id"],
        "entity_type": item["entity_type"],
        "properties": neo4j_properties(item["properties"]),
    }


def _neo4j_patch(item: GraphRecord) -> GraphRecord:
    return {"id": item["id"], "properties": neo4j_properties(item["properties"])}


def _neo4j_assertion(item: GraphRecord) -> GraphRecord:
    return {
        "id": item["id"],
        "subject_id": item["subject_id"],
        "object_id": item["object_id"],
        "predicate_key": item["predicate_key"],
        "relation_type_id": item["relation_type_id"],
        "properties": neo4j_properties(item["properties"]),
    }


def _apply_result_from_properties(
    properties: Mapping[str, Any], *, already_applied: bool
) -> GraphApplyResult:
    return GraphApplyResult(
        workspace_id=str(properties["workspace_id"]),
        revision_id=str(properties["revision_id"]),
        nodes_added=int(properties.get("nodes_added", 0)),
        nodes_updated=int(properties.get("nodes_updated", 0)),
        assertions_added=int(properties.get("assertions_added", 0)),
        assertions_superseded=int(properties.get("assertions_superseded", 0)),
        provenance_links_added=int(properties.get("provenance_links_added", 0)),
        merge_candidates_recorded=int(properties.get("merge_candidates_recorded", 0)),
        conflicts_recorded=int(properties.get("conflicts_recorded", 0)),
        already_applied=already_applied,
    )


def _mapping_text(mapping: Mapping[str, Any], key: str) -> str | None:
    value = mapping.get(key)
    return str(value) if value is not None else None


def _clean_identifier(value: str, name: str) -> str:
    text = str(value).strip()
    if not text:
        raise GraphPayloadError(f"{name} must not be empty")
    if len(text) > 512:
        raise GraphPayloadError(f"{name} must not exceed 512 characters")
    return text


def _bounded_limit(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > _MAX_LIMIT:
        raise GraphPayloadError(f"limit must be between 1 and {_MAX_LIMIT}")
    return value


def _bounded_depth(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > _MAX_DEPTH:
        raise GraphPayloadError(f"max_depth must be between 1 and {_MAX_DEPTH}")
    return value


def _json_scalar(value: object) -> object:
    iso_format = getattr(value, "iso_format", None)
    if callable(iso_format):
        return iso_format()
    isoformat = getattr(value, "isoformat", None)
    if callable(isoformat):
        return isoformat()
    return value
