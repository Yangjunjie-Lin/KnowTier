"""Validation and normalization at the graph projection boundary."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from enum import Enum
from typing import Any
from uuid import UUID

from .errors import GraphPayloadError
from .models import GraphDeltaInput, GraphRecord

_NODE_CONTROL_FIELDS = {
    "id",
    "node_id",
    "workspace_id",
    "entity_type",
    "node_type",
    "type",
    "label",
    "properties",
    "source_span_ids",
}
_PATCH_CONTROL_FIELDS = _NODE_CONTROL_FIELDS | {
    "patch",
    "changes",
    "set_properties",
    "expected_revision_id",
}
_ASSERTION_CONTROL_FIELDS = {
    "id",
    "assertion_id",
    "workspace_id",
    "subject_id",
    "subject_node_id",
    "object_id",
    "object_node_id",
    "relation_type_id",
    "relation_type",
    "predicate",
    "predicate_key",
    "properties",
    "source_span_ids",
}


@dataclass(frozen=True, slots=True)
class NormalizedDelta:
    workspace_id: str
    base_revision_id: str | None
    generated_by_model_run_id: str | None
    add_nodes: tuple[GraphRecord, ...]
    update_nodes: tuple[GraphRecord, ...]
    add_assertions: tuple[GraphRecord, ...]
    supersede_assertions: tuple[GraphRecord, ...]
    add_provenance_links: tuple[GraphRecord, ...]
    merge_candidates: tuple[GraphRecord, ...]
    conflicts: tuple[GraphRecord, ...]
    raw: GraphRecord

    def deterministic_revision_id(self) -> str:
        encoded = json.dumps(self.raw, sort_keys=True, separators=(",", ":")).encode()
        return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def normalize_delta(delta: GraphDeltaInput) -> NormalizedDelta:
    raw = _as_mapping(delta, "delta")
    workspace_id = _required_identifier(raw, ("workspace_id",), "delta.workspace_id")
    base_revision_id = _optional_identifier(raw.get("base_revision_id"))
    generated_by_model_run_id = _optional_identifier(raw.get("generated_by_model_run_id"))

    nodes = tuple(
        _normalize_node(item, workspace_id, index)
        for index, item in enumerate(_sequence(raw, "add_nodes"))
    )
    patches = tuple(
        _normalize_patch(item, workspace_id, index)
        for index, item in enumerate(_sequence(raw, "update_nodes"))
    )
    assertions = tuple(
        _normalize_assertion(item, workspace_id, index)
        for index, item in enumerate(_sequence(raw, "add_assertions"))
    )
    supersedes = tuple(
        _normalize_supersede(item, workspace_id, index)
        for index, item in enumerate(_sequence(raw, "supersede_assertions"))
    )
    provenance = tuple(
        _normalize_provenance(item, workspace_id, index)
        for index, item in enumerate(_sequence(raw, "add_provenance_links"))
    )
    merges = tuple(
        _normalize_candidate(item, workspace_id, index, "merge")
        for index, item in enumerate(_sequence(raw, "merge_candidates"))
    )
    conflicts = tuple(
        _normalize_candidate(item, workspace_id, index, "conflict")
        for index, item in enumerate(_sequence(raw, "conflicts"))
    )

    _ensure_unique(nodes, "add_nodes")
    _ensure_unique(patches, "update_nodes")
    _ensure_unique(assertions, "add_assertions")
    _ensure_unique(merges, "merge_candidates")
    _ensure_unique(conflicts, "conflicts")

    canonical_raw = _json_value(raw)
    if not isinstance(canonical_raw, dict):
        raise GraphPayloadError("graph delta must serialize to an object")
    return NormalizedDelta(
        workspace_id=workspace_id,
        base_revision_id=base_revision_id,
        generated_by_model_run_id=generated_by_model_run_id,
        add_nodes=nodes,
        update_nodes=patches,
        add_assertions=assertions,
        supersede_assertions=supersedes,
        add_provenance_links=provenance,
        merge_candidates=merges,
        conflicts=conflicts,
        raw=canonical_raw,
    )


def neo4j_properties(properties: Mapping[str, Any]) -> GraphRecord:
    """Convert validated JSON values to Neo4j property values.

    Neo4j properties cannot contain maps or nested arrays. Nested values are kept
    as canonical JSON strings so the projection remains lossless and portable.
    """

    converted: GraphRecord = {}
    for key, value in properties.items():
        if not isinstance(key, str) or not key:
            raise GraphPayloadError("Neo4j property keys must be non-empty strings")
        if value is None:
            converted[key] = None
        elif isinstance(value, (str, int, float, bool)):
            converted[key] = value
        elif isinstance(value, list) and all(
            isinstance(entry, (str, int, float, bool)) for entry in value
        ):
            converted[key] = value
        else:
            converted[key] = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return converted


def decode_neo4j_properties(properties: Mapping[str, Any]) -> GraphRecord:
    """Return a detached, JSON-compatible copy of Neo4j properties."""

    return {str(key): _json_value(value) for key, value in properties.items()}


def _as_mapping(value: object, path: str) -> GraphRecord:
    if isinstance(value, Mapping):
        return {str(key): _json_value(item) for key, item in value.items()}
    dumper = getattr(value, "model_dump", None)
    if callable(dumper):
        dumped = dumper(mode="json")
        if isinstance(dumped, Mapping):
            return {str(key): _json_value(item) for key, item in dumped.items()}
    raise GraphPayloadError(f"{path} must be a mapping or Pydantic v2 model")


def _sequence(raw: Mapping[str, Any], key: str) -> Sequence[object]:
    value = raw.get(key, ())
    if value is None:
        return ()
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        raise GraphPayloadError(f"delta.{key} must be a list")
    return value


def _normalize_node(value: object, workspace_id: str, index: int) -> GraphRecord:
    item = _as_mapping(value, f"add_nodes[{index}]")
    _validate_workspace(item, workspace_id, f"add_nodes[{index}]")
    node_id = _required_identifier(item, ("id", "node_id"), f"add_nodes[{index}].id")
    entity_type = _required_identifier(
        item,
        ("entity_type", "node_type", "type", "label"),
        f"add_nodes[{index}].entity_type",
    )
    properties = _merged_properties(item, _NODE_CONTROL_FIELDS)
    source_span_ids = _identifier_list(item.get("source_span_ids", ()), f"add_nodes[{index}]")
    _require_confirmed_provenance(
        properties,
        source_span_ids,
        f"add_nodes[{index}]",
        evidence_carrier=entity_type
        in {
            "SourceDocument",
            "SourceSpan",
            "EntityType",
            "RelationType",
            "Constraint",
            "EpistemicStatus",
        },
    )
    return {
        "id": node_id,
        "entity_type": entity_type,
        "source_span_ids": source_span_ids,
        "properties": properties,
    }


def _normalize_patch(value: object, workspace_id: str, index: int) -> GraphRecord:
    item = _as_mapping(value, f"update_nodes[{index}]")
    _validate_workspace(item, workspace_id, f"update_nodes[{index}]")
    node_id = _required_identifier(item, ("id", "node_id"), f"update_nodes[{index}].id")
    properties = _merged_properties(
        item,
        _PATCH_CONTROL_FIELDS,
        ("properties", "patch", "changes", "set_properties"),
    )
    if not properties:
        raise GraphPayloadError(f"update_nodes[{index}] contains no changes")
    _reject_deletion_properties(properties, f"update_nodes[{index}]")
    source_span_ids = _identifier_list(item.get("source_span_ids", ()), f"update_nodes[{index}]")
    return {
        "id": node_id,
        "properties": properties,
        "source_span_ids": source_span_ids,
        "expected_revision_id": _optional_identifier(item.get("expected_revision_id")),
    }


def _normalize_assertion(value: object, workspace_id: str, index: int) -> GraphRecord:
    item = _as_mapping(value, f"add_assertions[{index}]")
    _validate_workspace(item, workspace_id, f"add_assertions[{index}]")
    assertion_id = _required_identifier(item, ("id", "assertion_id"), f"add_assertions[{index}].id")
    subject_id = _required_identifier(
        item,
        ("subject_id", "subject_node_id"),
        f"add_assertions[{index}].subject_id",
    )
    object_id = _required_identifier(
        item,
        ("object_id", "object_node_id"),
        f"add_assertions[{index}].object_id",
    )
    predicate = _required_identifier(
        item,
        ("predicate_key", "predicate", "relation_type", "relation_type_id"),
        f"add_assertions[{index}].predicate_key",
    )
    relation_type_id = _optional_identifier(item.get("relation_type_id"))
    source_span_ids = _identifier_list(item.get("source_span_ids", ()), f"add_assertions[{index}]")
    properties = _merged_properties(item, _ASSERTION_CONTROL_FIELDS)
    _require_confirmed_provenance(properties, source_span_ids, f"add_assertions[{index}]")
    return {
        "id": assertion_id,
        "subject_id": subject_id,
        "object_id": object_id,
        "predicate_key": predicate,
        "relation_type_id": relation_type_id,
        "source_span_ids": source_span_ids,
        "properties": properties,
    }


def _normalize_supersede(value: object, workspace_id: str, index: int) -> GraphRecord:
    item = _as_mapping(value, f"supersede_assertions[{index}]")
    _validate_workspace(item, workspace_id, f"supersede_assertions[{index}]")
    old_id = _required_identifier(
        item,
        ("assertion_id", "old_assertion_id", "superseded_assertion_id", "id"),
        f"supersede_assertions[{index}].assertion_id",
    )
    new_id = _first_optional_identifier(
        item, ("superseded_by_id", "new_assertion_id", "replacement_assertion_id")
    )
    superseded_at = _optional_text(item.get("superseded_at"))
    valid_to = _optional_text(item.get("valid_to"))
    return {
        "id": old_id,
        "superseded_by_id": new_id,
        "superseded_at": superseded_at,
        "valid_to": valid_to,
    }


def _normalize_provenance(value: object, workspace_id: str, index: int) -> GraphRecord:
    item = _as_mapping(value, f"add_provenance_links[{index}]")
    _validate_workspace(item, workspace_id, f"add_provenance_links[{index}]")
    target_id = _required_identifier(
        item,
        ("target_id", "entity_id", "node_id", "assertion_id"),
        f"add_provenance_links[{index}].target_id",
    )
    source_id = _required_identifier(
        item,
        ("source_span_id", "source_id"),
        f"add_provenance_links[{index}].source_span_id",
    )
    target_kind = str(item.get("target_kind", item.get("entity_kind", "any"))).lower()
    if target_kind not in {"any", "node", "assertion"}:
        raise GraphPayloadError(
            f"add_provenance_links[{index}].target_kind must be node, assertion, or any"
        )
    return {"target_id": target_id, "source_span_id": source_id, "target_kind": target_kind}


def _normalize_candidate(
    value: object, workspace_id: str, index: int, candidate_kind: str
) -> GraphRecord:
    item = _as_mapping(value, f"{candidate_kind}_candidates[{index}]")
    _validate_workspace(item, workspace_id, f"{candidate_kind}_candidates[{index}]")
    candidate_id = _first_optional_identifier(
        item, ("id", "candidate_id", "conflict_id", "conflict_set_id")
    )
    payload = _json_value(item)
    if not isinstance(payload, dict):
        raise GraphPayloadError(f"{candidate_kind}_candidates[{index}] must be an object")
    if candidate_id is None:
        digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        candidate_id = f"{candidate_kind}:{digest}"
    return {"id": candidate_id, "payload": payload}


def _merged_properties(
    item: Mapping[str, Any],
    control_fields: set[str],
    nested_keys: tuple[str, ...] = ("properties",),
) -> GraphRecord:
    properties: GraphRecord = {}
    for nested_key in nested_keys:
        nested = item.get(nested_key)
        if nested is None:
            continue
        if not isinstance(nested, Mapping):
            raise GraphPayloadError(f"{nested_key} must be an object")
        properties.update({str(key): _json_value(value) for key, value in nested.items()})
    properties.update(
        {str(key): _json_value(value) for key, value in item.items() if key not in control_fields}
    )
    for reserved in ("id", "workspace_id", "entity_type", "graph_revision_id"):
        properties.pop(reserved, None)
    return properties


def _required_identifier(item: Mapping[str, Any], keys: tuple[str, ...], path: str) -> str:
    value = _first_optional_identifier(item, keys)
    if value is None:
        raise GraphPayloadError(f"{path} is required")
    return value


def _first_optional_identifier(item: Mapping[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        if key in item and item[key] is not None:
            return _optional_identifier(item[key])
    return None


def _optional_identifier(value: object) -> str | None:
    if value is None:
        return None
    converted = _json_value(value)
    if not isinstance(converted, (str, int)) or isinstance(converted, bool):
        raise GraphPayloadError("identifiers must be strings, integers, or UUID values")
    text = str(converted).strip()
    if not text:
        raise GraphPayloadError("identifiers must not be empty")
    if len(text) > 512:
        raise GraphPayloadError("identifiers must not exceed 512 characters")
    return text


def _identifier_list(value: object, path: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        raise GraphPayloadError(f"{path}.source_span_ids must be a list")
    identifiers = [_optional_identifier(item) for item in value]
    return [identifier for identifier in identifiers if identifier is not None]


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    converted = _json_value(value)
    return str(converted)


def _validate_workspace(item: Mapping[str, Any], workspace_id: str, path: str) -> None:
    item_workspace = _optional_identifier(item.get("workspace_id"))
    if item_workspace is not None and item_workspace != workspace_id:
        raise GraphPayloadError(f"{path}.workspace_id differs from delta.workspace_id")


def _ensure_unique(items: Sequence[GraphRecord], path: str) -> None:
    identifiers = [str(item["id"]) for item in items]
    if len(identifiers) != len(set(identifiers)):
        raise GraphPayloadError(f"{path} contains duplicate identifiers")


def _reject_deletion_properties(properties: Mapping[str, Any], path: str) -> None:
    forbidden = {"delete", "deleted", "deleted_at", "hard_delete", "valid_to", "superseded_at"}
    illegal = sorted(key for key in properties if key.casefold() in forbidden)
    if illegal:
        raise GraphPayloadError(f"{path} cannot express deletion or supersession: {illegal!r}")


def _require_confirmed_provenance(
    properties: Mapping[str, Any],
    source_span_ids: Sequence[str],
    path: str,
    *,
    evidence_carrier: bool = False,
) -> None:
    status = str(properties.get("epistemic_status", "UNVERIFIED")).upper()
    if status == "CONFIRMED" and not evidence_carrier and not source_span_ids:
        raise GraphPayloadError(f"{path} cannot be CONFIRMED without a source span")


def _json_value(value: object) -> Any:
    if isinstance(value, Enum):
        return _json_value(value.value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_json_value(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    dumper = getattr(value, "model_dump", None)
    if callable(dumper):
        return _json_value(dumper(mode="json"))
    raise GraphPayloadError(f"unsupported graph payload value: {type(value).__name__}")
