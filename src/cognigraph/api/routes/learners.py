from __future__ import annotations

import csv
import io
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from cognigraph.api.dependencies import (
    RuntimeDependency,
    WorkspaceScopeDependency,
    enforce_workspace_scope,
)
from cognigraph.api.schemas import LearnerCreateRequest, LearnerResponse
from cognigraph.graph.query_tools import LearningPathParams
from cognigraph.persistence.postgres.models import (
    ConversationTurn,
    LearnerGraphRevision,
    LearnerRelationAssertion,
    MasteryEvidence,
)
from cognigraph.persistence.postgres.models import (
    Learner as LearnerRecord,
)
from cognigraph.services.runtime import ApplicationRuntime

router = APIRouter(tags=["learners"])


@router.post(
    "/learners",
    response_model=LearnerResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_learner(
    request: LearnerCreateRequest,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
) -> LearnerResponse:
    enforce_workspace_scope(workspace_scope, request.workspace_id)
    try:
        async with runtime.database.unit_of_work() as unit:
            if await unit.workspaces.get(request.workspace_id) is None:
                raise HTTPException(status_code=404, detail="workspace not found")
            learner = await unit.learners.create(
                workspace_id=request.workspace_id,
                display_name=request.display_name,
                external_id=request.external_id,
                language=request.language,
                preferences=request.preferences,
            )
            await unit.commit()
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="learner already exists") from exc
    return LearnerResponse.model_validate(learner, from_attributes=True)


@router.get("/learners/{learner_id}", response_model=LearnerResponse)
async def get_learner(
    learner_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
) -> LearnerResponse:
    async with runtime.database.unit_of_work() as unit:
        learner = await unit.learners.get(learner_id)
    if learner is None:
        raise HTTPException(status_code=404, detail="learner not found")
    enforce_workspace_scope(workspace_scope, learner.workspace_id)
    return LearnerResponse.model_validate(learner, from_attributes=True)


@router.get("/learners/{learner_id}/model")
async def get_learner_model(
    learner_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
) -> dict[str, object]:
    learner, rows = await _model_rows(runtime, learner_id, workspace_scope=workspace_scope)
    return {
        "learner_id": str(learner.id),
        "workspace_id": str(learner.workspace_id),
        "items": rows,
    }


@router.get("/learners/{learner_id}/model.csv")
async def export_learner_model_csv(
    learner_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
) -> Response:
    _learner, rows = await _model_rows(runtime, learner_id, workspace_scope=workspace_scope)
    columns = [
        "knowledge_point_id",
        "knowledge_point",
        "current_level",
        "mastery_score",
        "confidence",
        "evidence_count",
        "critical_misconceptions",
        "prerequisite_status",
        "last_interaction_at",
        "next_review_at",
        "recommended_action",
    ]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        serialized = dict(row)
        misconceptions = row["critical_misconceptions"]
        if not isinstance(misconceptions, list):
            misconceptions = []
        serialized["critical_misconceptions"] = " | ".join(str(item) for item in misconceptions)
        writer.writerow({key: _csv_safe_value(value) for key, value in serialized.items()})
    return Response(
        content=output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="learner-{learner_id}.csv"'},
    )


@router.get("/learners/{learner_id}/graph/revisions")
async def list_learner_graph_revisions(
    learner_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
    limit: int = Query(default=100, ge=1, le=1000),
) -> dict[str, object]:
    async with runtime.database.unit_of_work() as unit:
        learner = await unit.learners.get(learner_id)
        if learner is None:
            raise HTTPException(status_code=404, detail="learner not found")
        enforce_workspace_scope(workspace_scope, learner.workspace_id)
        revisions = await unit.learner_graph.list_revisions(
            learner_id,
            workspace_id=learner.workspace_id,
            limit=limit,
        )
    return {
        "learner_id": str(learner_id),
        "workspace_id": str(learner.workspace_id),
        "items": [_learner_revision_data(item) for item in revisions],
    }


@router.get("/learners/{learner_id}/graph/revisions/{revision_id}")
async def get_learner_graph_revision(
    learner_id: UUID,
    revision_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
) -> dict[str, object]:
    async with runtime.database.unit_of_work() as unit:
        learner = await unit.learners.get(learner_id)
        if learner is None:
            raise HTTPException(status_code=404, detail="learner not found")
        enforce_workspace_scope(workspace_scope, learner.workspace_id)
        revision = await unit.learner_graph.get_revision(
            learner_id,
            revision_id,
            workspace_id=learner.workspace_id,
        )
        if revision is None:
            raise HTTPException(status_code=404, detail="learner graph revision not found")
        assertions = await unit.learner_graph.list_assertions(
            learner_id,
            workspace_id=learner.workspace_id,
            revision_id=revision.id,
        )
        events = [
            event
            for event in await unit.learner_graph.list_change_events(
                learner_id,
                workspace_id=learner.workspace_id,
                limit=1000,
            )
            if event.learner_graph_revision_id == revision.id
        ]
    payload = _learner_revision_data(revision)
    payload["assertions"] = [_learner_assertion_data(item) for item in assertions]
    payload["events"] = [
        {
            "id": str(event.id),
            "event_type": event.event_type,
            "idempotency_key": event.idempotency_key,
            "delta": event.delta,
            "created_at": event.created_at.isoformat(),
        }
        for event in events
    ]
    return payload


@router.get("/learners/{learner_id}/graph/assertions/{assertion_id}")
async def get_learner_graph_assertion(
    learner_id: UUID,
    assertion_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
) -> dict[str, object]:
    async with runtime.database.unit_of_work() as unit:
        learner = await unit.learners.get(learner_id)
        if learner is None:
            raise HTTPException(status_code=404, detail="learner not found")
        enforce_workspace_scope(workspace_scope, learner.workspace_id)
        detail = await unit.learner_graph.get_assertion_detail(
            learner_id,
            assertion_id,
            workspace_id=learner.workspace_id,
        )
        if detail is None:
            raise HTTPException(status_code=404, detail="learner graph assertion not found")
        db_session = unit.session
        if db_session is None:
            raise RuntimeError("unit of work did not initialize its SQL session")
        replacement = await db_session.scalar(
            select(LearnerRelationAssertion)
            .where(
                LearnerRelationAssertion.learner_id == learner_id,
                LearnerRelationAssertion.workspace_id == learner.workspace_id,
                LearnerRelationAssertion.supersedes_assertion_id == assertion_id,
            )
            .order_by(LearnerRelationAssertion.created_at.desc())
            .limit(1)
        )
        source_turn = None
        if detail.assertion.source_turn_id is not None:
            source_turn = await db_session.scalar(
                select(ConversationTurn).where(
                    ConversationTurn.id == detail.assertion.source_turn_id,
                    ConversationTurn.workspace_id == learner.workspace_id,
                    ConversationTurn.learner_id == learner_id,
                )
            )
        evidence = None
        if detail.assertion.mastery_evidence_id is not None:
            evidence = await db_session.scalar(
                select(MasteryEvidence).where(
                    MasteryEvidence.id == detail.assertion.mastery_evidence_id,
                    MasteryEvidence.workspace_id == learner.workspace_id,
                    MasteryEvidence.learner_id == learner_id,
                )
            )
        knowledge_state = await unit.learner_states.get(
            learner_id,
            detail.assertion.object_id,
            workspace_id=learner.workspace_id,
        )
        knowledge_node = await unit.graph.get_node(
            learner.workspace_id,
            detail.assertion.object_id,
            active_only=True,
        )
    payload = _learner_assertion_data(detail.assertion)
    payload.update(
        {
            "learner": {
                "id": str(learner.id),
                "workspace_id": str(learner.workspace_id),
                "display_name": learner.display_name,
            },
            "source_turn": _turn_data(source_turn),
            "evidence": _evidence_data(evidence),
            "formation_reason": detail.assertion.natural_language_description,
            "grader_scores": (
                {
                    "correctness": evidence.correctness_score,
                    "reasoning": evidence.reasoning_score,
                    "independence": evidence.independence_score,
                    "transfer": evidence.transfer_score,
                    "confidence": evidence.grader_confidence,
                }
                if evidence is not None
                else None
            ),
            "misconceptions": (
                evidence.observed_misconceptions
                if evidence is not None
                else knowledge_state.critical_misconceptions
                if knowledge_state is not None
                else []
            ),
            "knowledge_state": (
                {
                    "knowledge_point_id": str(knowledge_state.knowledge_point_id),
                    "current_level": knowledge_state.current_level,
                    "mastery_score": knowledge_state.mastery_score,
                    "confidence": knowledge_state.confidence,
                    "critical_misconceptions": knowledge_state.critical_misconceptions,
                }
                if knowledge_state is not None
                else None
            ),
            "knowledge_point": (
                {
                    "id": str(knowledge_node.id),
                    "name": str(
                        knowledge_node.display_name
                        or knowledge_node.properties.get("display_name")
                        or knowledge_node.properties.get("canonical_name")
                        or knowledge_node.id
                    ),
                }
                if knowledge_node is not None
                else None
            ),
            "sources": [
                {
                    "id": str(source.id),
                    "document_id": str(source.document_id),
                    "page_number": source.page_number,
                    "bounding_box": source.bounding_box,
                    "text": source.text,
                }
                for source in detail.sources
            ],
            "superseded_by": str(replacement.id) if replacement is not None else None,
            "superseded_by_assertion_id": (
                str(replacement.id) if replacement is not None else None
            ),
            "is_active": detail.assertion.valid_to is None
            and detail.assertion.superseded_at is None,
        }
    )
    return {"data": payload}


@router.get("/learners/{learner_id}/graph/nodes/{node_id}")
async def get_learner_graph_node(
    learner_id: UUID,
    node_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
) -> dict[str, object]:
    async with runtime.database.unit_of_work() as unit:
        learner = await unit.learners.get(learner_id)
        if learner is None:
            raise HTTPException(status_code=404, detail="learner not found")
        enforce_workspace_scope(workspace_scope, learner.workspace_id)
        state = await unit.learner_states.get(
            learner_id,
            node_id,
            workspace_id=learner.workspace_id,
        )
        db_session = unit.session
        if db_session is None:
            raise RuntimeError("unit of work did not initialize its SQL session")
        evidence = await db_session.scalar(
            select(MasteryEvidence).where(
                MasteryEvidence.id == node_id,
                MasteryEvidence.workspace_id == learner.workspace_id,
                MasteryEvidence.learner_id == learner_id,
            )
        )
        assertions = await unit.learner_graph.list_assertions(
            learner_id,
            workspace_id=learner.workspace_id,
            active_only=True,
            limit=1000,
        )
        domain_node = await unit.graph.get_node(
            learner.workspace_id,
            node_id,
            active_only=True,
        )
    related = [
        item for item in assertions if item.subject_id == node_id or item.object_id == node_id
    ]
    if (
        state is None
        and evidence is None
        and domain_node is None
        and node_id != learner.id
        and not related
    ):
        raise HTTPException(status_code=404, detail="learner graph node not found")
    data: dict[str, object] = {
        "id": str(node_id),
        "type": (
            "LearnerKnowledgeState"
            if state is not None
            else "MasteryEvidence"
            if evidence is not None
            else "LearnerResource"
        ),
        "learner_id": str(learner_id),
        "knowledge_point_id": str(state.knowledge_point_id) if state is not None else None,
        "current_level": state.current_level if state is not None else None,
        "mastery_score": state.mastery_score if state is not None else None,
        "confidence": state.confidence if state is not None else None,
        "evidence": _evidence_data(evidence),
        "domain_node": (
            {
                "id": str(domain_node.id),
                "type": domain_node.entity_type,
                "properties": domain_node.properties,
            }
            if domain_node is not None
            else None
        ),
        "assertions": [_learner_assertion_data(item) for item in related],
    }
    return {"data": data}


@router.get("/learners/{learner_id}/knowledge-graph")
async def get_learner_knowledge_graph(
    learner_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
) -> dict[str, object]:
    learner, rows = await _model_rows(runtime, learner_id, workspace_scope=workspace_scope)
    async with runtime.database.unit_of_work() as unit:
        revision = await unit.learner_graph.latest_revision(
            learner_id,
            workspace_id=learner.workspace_id,
        )
        assertions = await unit.learner_graph.list_assertions(
            learner_id,
            workspace_id=learner.workspace_id,
            # Keep superseded edges in the projection so a user can inspect
            # the evidence trail and replacement relationship from the graph.
            active_only=False,
            limit=5000,
        )
    learner_node = {
        "data": {
            "id": str(learner.id),
            "type": "Learner",
            "label": learner.display_name,
            "learner_graph_revision_id": str(revision.id) if revision is not None else None,
        }
    }
    state_node_ids = {
        UUID(str(row["knowledge_point_id"])): str(row["knowledge_point_id"])
        for row in rows
        if row.get("knowledge_point_id") is not None
    }
    state_nodes = [
        {
            "data": {
                "id": str(row["knowledge_point_id"]),
                "type": "LearnerKnowledgeState",
                "knowledge_point_id": row["knowledge_point_id"],
                "label": row["knowledge_point"],
                "current_level": row["current_level"],
                "mastery_score": row["mastery_score"],
                "confidence": row["confidence"],
                "prerequisites": row.get("prerequisites", []),
                "all_prerequisites_mastered": row.get("all_prerequisites_mastered", True),
                "learner_graph_revision_id": (str(revision.id) if revision is not None else None),
            }
        }
        for row in rows
    ]
    known_node_ids = {str(learner.id)}
    known_node_ids.update(str(row["knowledge_point_id"]) for row in rows)
    resource_ids = sorted(
        {
            str(endpoint)
            for assertion in assertions
            for endpoint in (assertion.subject_id, assertion.object_id)
            if str(endpoint) not in known_node_ids
        }
    )
    resource_nodes = [
        {
            "data": {
                "id": resource_id,
                "type": "LearnerGraphResource",
                "label": resource_id,
                "learner_graph_revision_id": str(revision.id) if revision is not None else None,
            }
        }
        for resource_id in resource_ids
    ]
    edges: list[dict[str, object]] = []
    replacement_by_old = {
        str(assertion.supersedes_assertion_id): str(assertion.id)
        for assertion in assertions
        if assertion.supersedes_assertion_id is not None
    }
    for assertion in assertions:
        source = state_node_ids.get(assertion.subject_id, str(assertion.subject_id))
        target = state_node_ids.get(assertion.object_id, str(assertion.object_id))
        edges.append(
            {
                "data": {
                    "id": str(assertion.id),
                    "assertion_id": str(assertion.id),
                    "source": source,
                    "target": target,
                    "relation_type": assertion.predicate,
                    "predicate": assertion.predicate,
                    "natural_language_description": assertion.natural_language_description,
                    "confidence": assertion.confidence,
                    "learner_graph_revision_id": str(assertion.learner_graph_revision_id),
                    "source_turn_id": (
                        str(assertion.source_turn_id) if assertion.source_turn_id else None
                    ),
                    "evidence_id": (
                        str(assertion.mastery_evidence_id)
                        if assertion.mastery_evidence_id
                        else None
                    ),
                    "superseded_by_assertion_id": replacement_by_old.get(str(assertion.id)),
                    "valid_from": assertion.valid_from.isoformat(),
                    "valid_to": assertion.valid_to.isoformat() if assertion.valid_to else None,
                }
            }
        )
    return {
        "elements": {
            "nodes": [learner_node, *state_nodes, *resource_nodes],
            "edges": edges,
        },
        "meta": {
            # Preserve the historical metadata value for clients that use it
            # as a display label; the new field declares the edge projection.
            "projection": "learner-state-only",
            "assertion_projection": "first-class-learner-relations",
            "learner_graph_revision_id": str(revision.id) if revision is not None else None,
            "assertion_count": len(assertions),
        },
    }


@router.get("/learners/{learner_id}/learning-path")
async def get_learning_path(
    learner_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
    target_knowledge_point_id: UUID | None = Query(default=None),
) -> dict[str, object]:
    learner, rows = await _model_rows(runtime, learner_id, workspace_scope=workspace_scope)
    snapshot = await runtime.ensure_graph_loaded(learner.workspace_id)
    target_id = target_knowledge_point_id
    if target_id is None:
        target_id = next(
            (
                node.id
                for node in snapshot.nodes
                if node.node_type.value == "KnowledgePoint"
                and all(row["knowledge_point_id"] != str(node.id) for row in rows)
            ),
            None,
        )
    if target_id is None:
        return {"learner_id": str(learner_id), "knowledge_point_ids": []}
    try:
        result = await runtime.semantic_queries.get_learning_path(
            LearningPathParams(
                workspace_id=learner.workspace_id,
                learner_id=learner_id,
                target_knowledge_point_id=target_id,
            )
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="target knowledge point not found") from exc
    return result.model_dump(mode="json")


@router.get("/learners/{learner_id}/evidence")
async def get_learner_evidence(
    learner_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
    limit: int = Query(default=100, ge=1, le=1000),
) -> dict[str, object]:
    async with runtime.database.unit_of_work() as unit:
        learner = await unit.learners.get(learner_id)
        if learner is None:
            raise HTTPException(status_code=404, detail="learner not found")
        enforce_workspace_scope(workspace_scope, learner.workspace_id)
        evidence = await unit.learner_states.list_evidence(
            learner_id,
            limit=limit,
            workspace_id=learner.workspace_id,
        )
    return {
        "learner_id": str(learner_id),
        "items": [
            {
                "id": str(item.id),
                "knowledge_point_id": str(item.knowledge_point_id),
                "session_id": str(item.session_id),
                "turn_id": str(item.turn_id),
                "evidence_type": item.evidence_type,
                "cognitive_level": item.cognitive_level,
                "correctness_score": item.correctness_score,
                "reasoning_score": item.reasoning_score,
                "independence_score": item.independence_score,
                "transfer_score": item.transfer_score,
                "grader_confidence": item.grader_confidence,
                "observed_misconceptions": item.observed_misconceptions,
                "grader_explanation": item.grader_explanation,
                "created_at": item.created_at.isoformat(),
            }
            for item in evidence
        ],
    }


async def _model_rows(
    runtime: ApplicationRuntime,
    learner_id: UUID,
    *,
    workspace_scope: UUID | None = None,
) -> tuple[LearnerRecord, list[dict[str, object]]]:
    async with runtime.database.unit_of_work() as unit:
        learner = await unit.learners.get(learner_id)
        if learner is None:
            raise HTTPException(status_code=404, detail="learner not found")
        enforce_workspace_scope(workspace_scope, learner.workspace_id)
        states = await unit.learner_states.list_states_for_workspace(
            learner_id,
            workspace_id=learner.workspace_id,
        )
    snapshot = await runtime.ensure_graph_loaded(learner.workspace_id)
    nodes = snapshot.node_map()
    prerequisite_map: dict[UUID, list[tuple[int, UUID]]] = {}
    for definition_index, assertion in enumerate(snapshot.assertions):
        if not assertion.is_active or assertion.predicate_key.value != "REQUIRES":
            continue
        prerequisite_map.setdefault(assertion.subject_id, []).append(
            (definition_index, assertion.object_id)
        )
    state_by_point = {item.knowledge_point_id: item for item in states}
    rows: list[dict[str, object]] = []
    for item in states:
        node = nodes.get(item.knowledge_point_id)
        name = str(
            (node.properties.get("display_name") if node else None)
            or (node.properties.get("canonical_name") if node else None)
            or item.knowledge_point_id
        )
        prerequisites: list[dict[str, object]] = []
        for definition_index, prerequisite_id in prerequisite_map.get(item.knowledge_point_id, []):
            prerequisite_state = state_by_point.get(prerequisite_id)
            score = prerequisite_state.mastery_score if prerequisite_state is not None else 0.0
            level = int(prerequisite_state.current_level) if prerequisite_state is not None else 1
            prerequisite_node = nodes.get(prerequisite_id)
            prerequisites.append(
                {
                    "knowledge_point_id": str(prerequisite_id),
                    "knowledge_point": str(
                        (
                            prerequisite_node.properties.get("display_name")
                            if prerequisite_node
                            else None
                        )
                        or (
                            prerequisite_node.properties.get("canonical_name")
                            if prerequisite_node
                            else None
                        )
                        or prerequisite_id
                    ),
                    "mastery_score": score,
                    "current_level": level,
                    "status": "mastered" if score >= 0.75 and level >= 2 else "not_mastered",
                    "definition_order": definition_index,
                }
            )
        prerequisites.sort(
            key=lambda value: (
                0 if value["status"] != "mastered" else 1,
                float(str(value["mastery_score"])),
                int(str(value["definition_order"])),
                str(value["knowledge_point_id"]),
            )
        )
        all_prerequisites_mastered = bool(prerequisites) and all(
            item["status"] == "mastered" for item in prerequisites
        )
        rows.append(
            {
                "knowledge_point_id": str(item.knowledge_point_id),
                "knowledge_point": name,
                "current_level": item.current_level,
                "mastery_score": item.mastery_score,
                "confidence": item.confidence,
                "evidence_count": item.evidence_count,
                "critical_misconceptions": item.critical_misconceptions,
                "prerequisites": [
                    {key: value for key, value in prerequisite.items() if key != "definition_order"}
                    for prerequisite in prerequisites
                ],
                "all_prerequisites_mastered": (
                    all_prerequisites_mastered if prerequisites else True
                ),
                "prerequisite_status": (
                    "mastered"
                    if all_prerequisites_mastered
                    else "not_mastered"
                    if prerequisites
                    else "none"
                ),
                "last_interaction_at": (
                    item.last_interaction_at.isoformat() if item.last_interaction_at else None
                ),
                "next_review_at": item.next_review_at.isoformat() if item.next_review_at else None,
                "recommended_action": _recommended_action(item.mastery_score, item.current_level),
            }
        )
    return learner, rows


def _recommended_action(mastery_score: float, current_level: int) -> str:
    if mastery_score < 0.35:
        return "REMEDIATE"
    if mastery_score < 0.75:
        return "REQUEST_MORE_EVIDENCE"
    if current_level < 6:
        return "ASSESS_FOR_PROMOTION"
    return "REVIEW"


def _learner_revision_data(revision: LearnerGraphRevision) -> dict[str, object]:
    summary = revision.change_summary
    return {
        "id": str(revision.id),
        "workspace_id": str(revision.workspace_id),
        "learner_id": str(revision.learner_id),
        "session_id": str(revision.session_id),
        "turn_id": str(revision.turn_id),
        "sequence_number": revision.sequence_number,
        "parent_revision_id": (
            str(revision.parent_revision_id) if revision.parent_revision_id is not None else None
        ),
        "change_summary": summary,
        "assertions_added": summary.get("assertions_added", 0),
        "assertions_superseded": summary.get("assertions_superseded", 0),
        "created_at": revision.created_at.isoformat(),
    }


def _learner_assertion_data(assertion: LearnerRelationAssertion) -> dict[str, object]:
    return {
        "id": str(assertion.id),
        "workspace_id": str(assertion.workspace_id),
        "learner_id": str(assertion.learner_id),
        "subject_id": str(assertion.subject_id),
        "predicate": assertion.predicate,
        "relation_type": assertion.predicate,
        "object_id": str(assertion.object_id),
        "natural_language_description": assertion.natural_language_description,
        "confidence": assertion.confidence,
        "valid_from": assertion.valid_from.isoformat(),
        "valid_to": assertion.valid_to.isoformat() if assertion.valid_to else None,
        "created_at": assertion.created_at.isoformat(),
        "superseded_at": (assertion.superseded_at.isoformat() if assertion.superseded_at else None),
        "source_turn_id": str(assertion.source_turn_id) if assertion.source_turn_id else None,
        "mastery_evidence_id": (
            str(assertion.mastery_evidence_id) if assertion.mastery_evidence_id else None
        ),
        "evidence_id": (
            str(assertion.mastery_evidence_id) if assertion.mastery_evidence_id else None
        ),
        "learner_graph_revision_id": str(assertion.learner_graph_revision_id),
        "supersedes_assertion_id": (
            str(assertion.supersedes_assertion_id) if assertion.supersedes_assertion_id else None
        ),
        "is_active": assertion.valid_to is None and assertion.superseded_at is None,
    }


def _turn_data(turn: ConversationTurn | None) -> dict[str, object] | None:
    if turn is None:
        return None
    return {
        "id": str(turn.id),
        "session_id": str(turn.session_id),
        "role": turn.role,
        "content": turn.content,
        "assessment": turn.assessment,
        "created_at": turn.created_at.isoformat(),
    }


def _evidence_data(evidence: MasteryEvidence | None) -> dict[str, object] | None:
    if evidence is None:
        return None
    return {
        "id": str(evidence.id),
        "knowledge_point_id": str(evidence.knowledge_point_id),
        "turn_id": str(evidence.turn_id),
        "correctness_score": evidence.correctness_score,
        "reasoning_score": evidence.reasoning_score,
        "independence_score": evidence.independence_score,
        "transfer_score": evidence.transfer_score,
        "grader_confidence": evidence.grader_confidence,
        "observed_misconceptions": evidence.observed_misconceptions,
        "grader_explanation": evidence.grader_explanation,
        "created_at": evidence.created_at.isoformat(),
    }


def _csv_safe_value(value: object) -> object:
    """Prevent spreadsheet programs from interpreting learner-controlled text as formulas."""

    if not isinstance(value, str):
        return value
    candidate = value.lstrip()
    if candidate.startswith(("=", "+", "-", "@", "\t", "\r")):
        return f"'{value}"
    return value
