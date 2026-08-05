"""Deterministic in-memory semantic graph repository for tests and demos."""

from __future__ import annotations

import asyncio
import copy
from collections import Counter, deque
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime

from .errors import GraphPayloadError, GraphRevisionConflict
from .models import GraphApplyResult, GraphDeltaInput, GraphRecord
from .ordering import topological_knowledge_points
from .payload import NormalizedDelta, normalize_delta

_MAX_LIMIT = 500
_MAX_DEPTH = 5


class InMemoryGraphRepository:
    """Behavior-compatible graph projection without external services."""

    def __init__(self) -> None:
        self._nodes: dict[tuple[str, str], GraphRecord] = {}
        self._assertions: dict[tuple[str, str], GraphRecord] = {}
        self._provenance: set[tuple[str, str, str]] = set()
        self._merge_candidates: dict[tuple[str, str], GraphRecord] = {}
        self._conflicts: dict[tuple[str, str], GraphRecord] = {}
        self._revisions: dict[str, str] = {}
        self._revision_updated_at: dict[str, str] = {}
        self._applications: dict[tuple[str, str], GraphApplyResult] = {}
        self._lock = asyncio.Lock()
        self._closed = False

    async def __aenter__(self) -> InMemoryGraphRepository:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: object | None,
    ) -> None:
        await self.close()

    async def create_schema(self) -> None:
        self._ensure_open()

    async def is_ready(self) -> bool:
        return not self._closed

    async def get_current_revision(self, workspace_id: str) -> str | None:
        workspace = _clean_identifier(workspace_id, "workspace_id")
        return self._revisions.get(workspace)

    async def close(self) -> None:
        self._closed = True

    async def apply_delta(
        self,
        delta: GraphDeltaInput,
        revision_id: str | None = None,
        *,
        application_id: str | None = None,
    ) -> GraphApplyResult:
        self._ensure_open()
        normalized = normalize_delta(delta)
        resolved_revision = _clean_identifier(
            revision_id
            or _mapping_text(normalized.raw, "revision_id")
            or _mapping_text(normalized.raw, "graph_revision_id")
            or _mapping_text(normalized.raw, "id")
            or application_id
            or normalized.deterministic_revision_id(),
            "revision_id",
        )
        async with self._lock:
            key = (normalized.workspace_id, resolved_revision)
            applied = self._applications.get(key)
            if applied is not None:
                return GraphApplyResult(
                    workspace_id=applied.workspace_id,
                    revision_id=applied.revision_id,
                    nodes_added=applied.nodes_added,
                    nodes_updated=applied.nodes_updated,
                    assertions_added=applied.assertions_added,
                    assertions_superseded=applied.assertions_superseded,
                    provenance_links_added=applied.provenance_links_added,
                    merge_candidates_recorded=applied.merge_candidates_recorded,
                    conflicts_recorded=applied.conflicts_recorded,
                    already_applied=True,
                )
            current = self._revisions.get(normalized.workspace_id)
            if current != normalized.base_revision_id:
                raise GraphRevisionConflict(normalized.base_revision_id, current)

            snapshot = self._snapshot()
            try:
                summary = self._apply_normalized(normalized, resolved_revision)
            except Exception:
                self._restore(snapshot)
                raise
            self._applications[key] = summary
            self._revisions[normalized.workspace_id] = resolved_revision
            self._revision_updated_at[normalized.workspace_id] = datetime.now(UTC).isoformat()
            return summary

    def _apply_normalized(self, delta: NormalizedDelta, revision_id: str) -> GraphApplyResult:
        workspace_id = delta.workspace_id
        now = datetime.now(UTC).isoformat()
        pending_node_ids = {str(item["id"]) for item in delta.add_nodes}
        pending_assertion_ids = {str(item["id"]) for item in delta.add_assertions}

        existing_node_ids = sorted(
            node_id for node_id in pending_node_ids if (workspace_id, node_id) in self._nodes
        )
        if existing_node_ids:
            raise GraphPayloadError(f"graph nodes already exist: {existing_node_ids!r}")
        existing_assertion_ids = sorted(
            assertion_id
            for assertion_id in pending_assertion_ids
            if (workspace_id, assertion_id) in self._assertions
        )
        if existing_assertion_ids:
            raise GraphPayloadError(
                f"relation assertions already exist: {existing_assertion_ids!r}"
            )

        for item in delta.update_nodes:
            existing_patch_node = self._nodes.get((workspace_id, str(item["id"])))
            if existing_patch_node is None:
                raise GraphPayloadError(f"cannot patch missing graph node: {item['id']!r}")
            expected_revision = item["expected_revision_id"]
            if (
                expected_revision is not None
                and existing_patch_node.get("graph_revision_id") != expected_revision
            ):
                raise GraphRevisionConflict(
                    str(expected_revision),
                    str(existing_patch_node.get("graph_revision_id")),
                )

        source_ids = {
            str(source_id)
            for item in (*delta.add_nodes, *delta.update_nodes, *delta.add_assertions)
            for source_id in item["source_span_ids"]
        }
        source_ids.update(str(item["source_span_id"]) for item in delta.add_provenance_links)
        pending_types = {str(item["id"]): str(item["entity_type"]) for item in delta.add_nodes}
        for source_id in source_ids:
            if source_id in pending_types:
                if pending_types[source_id] != "SourceSpan":
                    raise GraphPayloadError(f"provenance source is not a SourceSpan: {source_id!r}")
                continue
            source = self._nodes.get((workspace_id, source_id))
            if source is None or source.get("entity_type") != "SourceSpan":
                raise GraphPayloadError(f"missing source span: {source_id!r}")

        for item in delta.add_assertions:
            for key in ("subject_id", "object_id"):
                node_id = str(item[key])
                if node_id not in pending_node_ids and (workspace_id, node_id) not in self._nodes:
                    raise GraphPayloadError(f"assertion references missing graph node: {node_id!r}")
            for source_id in item["source_span_ids"]:
                if (
                    str(source_id) not in pending_node_ids
                    and (
                        workspace_id,
                        str(source_id),
                    )
                    not in self._nodes
                ):
                    raise GraphPayloadError(
                        f"assertion references missing source span: {source_id!r}"
                    )
        for item in delta.supersede_assertions:
            for key in ("id", "superseded_by_id"):
                assertion_id = item[key]
                if assertion_id is None:
                    continue
                if (
                    str(assertion_id) not in pending_assertion_ids
                    and (
                        workspace_id,
                        str(assertion_id),
                    )
                    not in self._assertions
                ):
                    raise GraphPayloadError(
                        f"supersede operation references missing assertion: {assertion_id!r}"
                    )

        for item in delta.add_provenance_links:
            source_id = str(item["source_span_id"])
            target_id = str(item["target_id"])
            if source_id not in pending_node_ids and (workspace_id, source_id) not in self._nodes:
                raise GraphPayloadError(f"missing source span: {source_id!r}")
            if (
                target_id not in pending_node_ids
                and target_id not in pending_assertion_ids
                and (workspace_id, target_id) not in self._nodes
                and (workspace_id, target_id) not in self._assertions
            ):
                raise GraphPayloadError(f"missing provenance target: {target_id!r}")

        for item in delta.add_nodes:
            node_key = (workspace_id, str(item["id"]))
            existing = self._nodes.get(node_key, {})
            created_at = existing.get("created_at", now)
            self._nodes[node_key] = {
                **existing,
                **copy.deepcopy(item["properties"]),
                "id": str(item["id"]),
                "workspace_id": workspace_id,
                "entity_type": str(item["entity_type"]),
                "graph_revision_id": revision_id,
                "created_at": created_at,
                "updated_at": now,
            }
            for source_id in item["source_span_ids"]:
                self._provenance.add((workspace_id, str(item["id"]), str(source_id)))

        for item in delta.update_nodes:
            patch_key = (workspace_id, str(item["id"]))
            self._nodes[patch_key].update(copy.deepcopy(item["properties"]))
            self._nodes[patch_key]["graph_revision_id"] = revision_id
            self._nodes[patch_key]["updated_at"] = now
            for source_id in item["source_span_ids"]:
                self._provenance.add((workspace_id, str(item["id"]), str(source_id)))

        for item in delta.add_assertions:
            assertion_key = (workspace_id, str(item["id"]))
            existing = self._assertions.get(assertion_key, {})
            created_at = existing.get("created_at", now)
            self._assertions[assertion_key] = {
                **existing,
                **copy.deepcopy(item["properties"]),
                "id": str(item["id"]),
                "workspace_id": workspace_id,
                "subject_id": str(item["subject_id"]),
                "object_id": str(item["object_id"]),
                "predicate_key": str(item["predicate_key"]),
                "relation_type_id": item["relation_type_id"],
                "graph_revision_id": revision_id,
                "created_at": created_at,
                "updated_at": now,
            }
            for source_id in item["source_span_ids"]:
                self._provenance.add((workspace_id, str(item["id"]), str(source_id)))

        for item in delta.supersede_assertions:
            old = self._assertions[(workspace_id, str(item["id"]))]
            old["superseded_at"] = item["superseded_at"] or now
            old["valid_to"] = item["valid_to"] or now
            old["graph_revision_id"] = revision_id
            old["updated_at"] = now
            if item["superseded_by_id"] is not None:
                old["superseded_by_id"] = str(item["superseded_by_id"])

        for item in delta.add_provenance_links:
            self._provenance.add(
                (workspace_id, str(item["target_id"]), str(item["source_span_id"]))
            )

        for item in delta.merge_candidates:
            self._merge_candidates[(workspace_id, str(item["id"]))] = {
                "id": str(item["id"]),
                "workspace_id": workspace_id,
                "payload": copy.deepcopy(item["payload"]),
                "graph_revision_id": revision_id,
                "status": "PENDING",
                "created_at": now,
            }
        for item in delta.conflicts:
            self._conflicts[(workspace_id, str(item["id"]))] = {
                "id": str(item["id"]),
                "workspace_id": workspace_id,
                "payload": copy.deepcopy(item["payload"]),
                "graph_revision_id": revision_id,
                "status": "PENDING",
                "created_at": now,
            }

        return GraphApplyResult(
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

    async def search_knowledge_points(
        self, workspace_id: str, query: str, *, limit: int = 20
    ) -> GraphRecord:
        workspace = _clean_identifier(workspace_id, "workspace_id")
        bounded_limit = _bounded_limit(limit)
        needle = query.strip().lower()
        results = [
            copy.deepcopy(node)
            for (item_workspace, _), node in self._nodes.items()
            if item_workspace == workspace
            and node.get("entity_type") == "KnowledgePoint"
            and (
                not needle
                or needle
                in " ".join(
                    str(node.get(field, ""))
                    for field in ("canonical_name", "display_name", "summary")
                ).lower()
            )
        ]
        results.sort(key=lambda node: str(node.get("canonical_name", node["id"])))
        return self._versioned(workspace, {"nodes": results[:bounded_limit]})

    async def get_graph_manifest(self, workspace_id: str) -> GraphRecord:
        workspace = _clean_identifier(workspace_id, "workspace_id")
        nodes = [
            node for (item_workspace, _), node in self._nodes.items() if item_workspace == workspace
        ]
        assertions = [
            assertion
            for (item_workspace, _), assertion in self._assertions.items()
            if item_workspace == workspace
        ]
        domains = sorted(
            {
                str(node.get("name") or node.get("display_name") or node.get("canonical_name"))
                for node in nodes
                if node.get("entity_type") == "Domain"
                and (node.get("name") or node.get("display_name") or node.get("canonical_name"))
            }
        )
        theories = sorted(
            {
                str(node.get("name") or node.get("display_name") or node.get("canonical_name"))
                for node in nodes
                if node.get("entity_type") == "Theory"
                and (node.get("name") or node.get("display_name") or node.get("canonical_name"))
            }
        )
        clusters = Counter(
            str(node["domain"])
            for node in nodes
            if node.get("entity_type") == "KnowledgePoint" and node.get("domain")
        )
        updated_values = [str(node["updated_at"]) for node in nodes if node.get("updated_at")]
        return {
            "workspace_id": workspace,
            "revision_id": self._revisions.get(workspace),
            "ontology": {
                "entity_types": sorted(
                    {str(node["entity_type"]) for node in nodes if node.get("entity_type")}
                ),
                "relation_types": sorted(
                    {
                        str(assertion["predicate_key"])
                        for assertion in assertions
                        if assertion.get("predicate_key")
                    }
                ),
            },
            "top_level_domains": domains,
            "theories": theories,
            "knowledge_point_count": sum(
                node.get("entity_type") == "KnowledgePoint" for node in nodes
            ),
            "assertion_count": len(assertions),
            "source_count": sum(node.get("entity_type") == "SourceDocument" for node in nodes),
            "node_count": len(nodes),
            "major_clusters": [
                {"name": name, "node_count": count}
                for name, count in sorted(clusters.items(), key=lambda item: (-item[1], item[0]))[
                    :10
                ]
            ],
            "updated_at": self._revision_updated_at.get(
                workspace, max(updated_values, default=None)
            ),
        }

    async def get_node_detail(self, workspace_id: str, node_id: str) -> GraphRecord | None:
        workspace = _clean_identifier(workspace_id, "workspace_id")
        identifier = _clean_identifier(node_id, "node_id")
        node = self._nodes.get((workspace, identifier))
        if node is None:
            return None
        outgoing = [
            {
                "assertion": copy.deepcopy(assertion),
                "object": copy.deepcopy(self._nodes[(workspace, str(assertion["object_id"]))]),
            }
            for (item_workspace, _), assertion in self._assertions.items()
            if item_workspace == workspace and assertion["subject_id"] == identifier
        ]
        incoming = [
            {
                "assertion": copy.deepcopy(assertion),
                "subject": copy.deepcopy(self._nodes[(workspace, str(assertion["subject_id"]))]),
            }
            for (item_workspace, _), assertion in self._assertions.items()
            if item_workspace == workspace and assertion["object_id"] == identifier
        ]
        outgoing.sort(key=lambda entry: str(entry["assertion"]["id"]))
        incoming.sort(key=lambda entry: str(entry["assertion"]["id"]))
        return {
            "node": copy.deepcopy(node),
            **_node_detail_facets(node, outgoing, incoming),
            "outgoing_assertions": outgoing,
            "incoming_assertions": incoming,
            "sources": self._sources(workspace, identifier, 100),
            "revision_id": self._revisions.get(workspace),
        }

    async def get_relation_assertion_detail(
        self, workspace_id: str, assertion_id: str
    ) -> GraphRecord | None:
        workspace = _clean_identifier(workspace_id, "workspace_id")
        identifier = _clean_identifier(assertion_id, "assertion_id")
        assertion = self._assertions.get((workspace, identifier))
        if assertion is None:
            return None
        replacements = (
            [self._assertions[(workspace, str(assertion["superseded_by_id"]))]]
            if assertion.get("superseded_by_id") is not None
            else []
        )
        superseded = [
            value
            for (item_workspace, _), value in self._assertions.items()
            if item_workspace == workspace and value.get("superseded_by_id") == identifier
        ]
        conflicts = [
            copy.deepcopy(value)
            for (item_workspace, _), value in self._conflicts.items()
            if item_workspace == workspace and identifier in _conflict_assertion_ids(value)
        ]
        relation_type_id = assertion.get("relation_type_id")
        relation_type = (
            self._nodes.get((workspace, str(relation_type_id)))
            if relation_type_id is not None
            else None
        )
        return {
            "assertion": copy.deepcopy(assertion),
            "subject": copy.deepcopy(self._nodes[(workspace, str(assertion["subject_id"]))]),
            "object": copy.deepcopy(self._nodes[(workspace, str(assertion["object_id"]))]),
            "relation_type": copy.deepcopy(relation_type)
            if relation_type is not None
            else {"workspace_id": workspace, "name": assertion["predicate_key"]},
            "conflicts": conflicts,
            "replacements": copy.deepcopy(replacements),
            "superseded_assertions": copy.deepcopy(superseded),
            "sources": self._sources(workspace, identifier, 100),
            "revision_id": self._revisions.get(workspace),
        }

    async def get_prerequisite_chain(
        self, workspace_id: str, node_id: str, *, max_depth: int = 3, limit: int = 100
    ) -> GraphRecord:
        return self._walk_subgraph(
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
        entries: list[GraphRecord] = []
        for (item_workspace, _), assertion in self._assertions.items():
            if item_workspace != workspace or identifier not in {
                assertion["subject_id"],
                assertion["object_id"],
            }:
                continue
            other_id = (
                assertion["object_id"]
                if assertion["subject_id"] == identifier
                else assertion["subject_id"]
            )
            other = self._nodes[(workspace, str(other_id))]
            if other.get("entity_type") == "Theory":
                entries.append(
                    {"theory": copy.deepcopy(other), "assertion": copy.deepcopy(assertion)}
                )
        entries.sort(key=lambda entry: str(entry["theory"].get("canonical_name", "")))
        return self._versioned(workspace, {"theories": entries[:bounded_limit]})

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
            path["learner_state"] = (
                await self.get_learner_state(
                    workspace_id,
                    learner_id,
                    knowledge_point_ids=[str(node["id"]) for node in path["nodes"]],
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
        bounded_limit = _bounded_limit(limit)
        filter_ids = {
            _clean_identifier(value, "knowledge_point_id") for value in knowledge_point_ids
        }
        states = [
            copy.deepcopy(node)
            for (item_workspace, _), node in self._nodes.items()
            if item_workspace == workspace
            and node.get("entity_type") == "LearnerKnowledgeState"
            and node.get("learner_id") == learner
            and (not filter_ids or node.get("knowledge_point_id") in filter_ids)
        ]
        states.sort(key=lambda state: str(state.get("knowledge_point_id", "")))
        return self._versioned(workspace, {"learner_id": learner, "states": states[:bounded_limit]})

    async def get_supporting_sources(
        self, workspace_id: str, entity_id: str, *, limit: int = 20
    ) -> GraphRecord:
        workspace = _clean_identifier(workspace_id, "workspace_id")
        identifier = _clean_identifier(entity_id, "entity_id")
        return self._versioned(
            workspace,
            {"entity_id": identifier, "sources": self._sources(workspace, identifier, limit)},
        )

    async def get_focus_subgraph(
        self,
        workspace_id: str,
        node_ids: Sequence[str],
        *,
        max_depth: int = 2,
        max_nodes: int = 100,
    ) -> GraphRecord:
        return self._walk_subgraph(
            workspace_id,
            node_ids,
            predicates=(),
            direction="both",
            max_depth=max_depth,
            max_nodes=max_nodes,
        )

    def _walk_subgraph(
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
        node_map: dict[str, GraphRecord] = {
            node_id: copy.deepcopy(self._nodes[(workspace, node_id)])
            for node_id in roots
            if (workspace, node_id) in self._nodes
        }
        assertion_map: dict[str, GraphRecord] = {}
        frontier: deque[tuple[str, int]] = deque((node_id, 0) for node_id in node_map)
        expanded: set[str] = set()
        while frontier and len(node_map) <= bounded_nodes:
            node_id, current_depth = frontier.popleft()
            if node_id in expanded or current_depth >= depth:
                continue
            expanded.add(node_id)
            for (item_workspace, assertion_id), assertion in sorted(self._assertions.items()):
                if item_workspace != workspace:
                    continue
                if predicates and assertion["predicate_key"] not in predicates:
                    continue
                matches = (
                    direction == "both"
                    and node_id in {assertion["subject_id"], assertion["object_id"]}
                ) or (direction == "outgoing" and assertion["subject_id"] == node_id)
                if not matches:
                    continue
                new_node_ids = {
                    str(candidate_id)
                    for candidate_id in (assertion["subject_id"], assertion["object_id"])
                    if str(candidate_id) not in node_map
                }
                if len(node_map) + len(new_node_ids) > bounded_nodes:
                    continue
                assertion_map[assertion_id] = copy.deepcopy(assertion)
                for candidate_id in (assertion["subject_id"], assertion["object_id"]):
                    candidate = str(candidate_id)
                    if candidate not in node_map and len(node_map) < bounded_nodes:
                        node_map[candidate] = copy.deepcopy(self._nodes[(workspace, candidate)])
                        frontier.append((candidate, current_depth + 1))
        return self._versioned(
            workspace,
            {
                "nodes": [node_map[key] for key in sorted(node_map)],
                "assertions": [assertion_map[key] for key in sorted(assertion_map)],
            },
        )

    def _sources(self, workspace_id: str, entity_id: str, limit: int) -> list[GraphRecord]:
        bounded_limit = _bounded_limit(limit)
        source_ids = sorted(
            source_id
            for item_workspace, target_id, source_id in self._provenance
            if item_workspace == workspace_id and target_id == entity_id
        )
        result: list[GraphRecord] = []
        for source_id in source_ids[:bounded_limit]:
            source = copy.deepcopy(self._nodes[(workspace_id, source_id)])
            document_id = source.get("document_id")
            document = (
                self._nodes.get((workspace_id, str(document_id)))
                if document_id is not None
                else None
            )
            source["source_document"] = copy.deepcopy(document) if document else None
            result.append(source)
        return result

    def _versioned(self, workspace_id: str, payload: GraphRecord) -> GraphRecord:
        return {
            "workspace_id": workspace_id,
            "revision_id": self._revisions.get(workspace_id),
            **payload,
        }

    def _snapshot(
        self,
    ) -> tuple[
        dict[tuple[str, str], GraphRecord],
        dict[tuple[str, str], GraphRecord],
        set[tuple[str, str, str]],
        dict[tuple[str, str], GraphRecord],
        dict[tuple[str, str], GraphRecord],
    ]:
        return (
            copy.deepcopy(self._nodes),
            copy.deepcopy(self._assertions),
            set(self._provenance),
            copy.deepcopy(self._merge_candidates),
            copy.deepcopy(self._conflicts),
        )

    def _restore(
        self,
        snapshot: tuple[
            dict[tuple[str, str], GraphRecord],
            dict[tuple[str, str], GraphRecord],
            set[tuple[str, str, str]],
            dict[tuple[str, str], GraphRecord],
            dict[tuple[str, str], GraphRecord],
        ],
    ) -> None:
        (
            self._nodes,
            self._assertions,
            self._provenance,
            self._merge_candidates,
            self._conflicts,
        ) = snapshot

    def _ensure_open(self) -> None:
        if self._closed:
            raise RuntimeError("in-memory graph repository is closed")


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
    by_id = {str(node.get("id")): copy.deepcopy(node) for node in nodes if node.get("id")}
    return [by_id[node_id] for node_id in sorted(by_id)]


def _conflict_assertion_ids(conflict: GraphRecord) -> set[str]:
    payload = conflict.get("payload")
    if not isinstance(payload, dict):
        return set()
    assertion_ids = payload.get("assertion_ids")
    if not isinstance(assertion_ids, list):
        return set()
    return {str(item) for item in assertion_ids}


def _mapping_text(mapping: GraphRecord, key: str) -> str | None:
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
