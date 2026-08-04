from __future__ import annotations

import csv
import io
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy.exc import IntegrityError

from cognigraph.api.dependencies import RuntimeDependency
from cognigraph.api.schemas import LearnerCreateRequest, LearnerResponse
from cognigraph.graph.query_tools import LearningPathParams
from cognigraph.persistence.postgres.models import Learner as LearnerRecord
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
) -> LearnerResponse:
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
) -> LearnerResponse:
    async with runtime.database.unit_of_work() as unit:
        learner = await unit.learners.get(learner_id)
    if learner is None:
        raise HTTPException(status_code=404, detail="learner not found")
    return LearnerResponse.model_validate(learner, from_attributes=True)


@router.get("/learners/{learner_id}/model")
async def get_learner_model(
    learner_id: UUID,
    runtime: RuntimeDependency,
) -> dict[str, object]:
    learner, rows = await _model_rows(runtime, learner_id)
    return {
        "learner_id": str(learner.id),
        "workspace_id": str(learner.workspace_id),
        "items": rows,
    }


@router.get("/learners/{learner_id}/model.csv")
async def export_learner_model_csv(
    learner_id: UUID,
    runtime: RuntimeDependency,
) -> Response:
    _learner, rows = await _model_rows(runtime, learner_id)
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


@router.get("/learners/{learner_id}/knowledge-graph")
async def get_learner_knowledge_graph(
    learner_id: UUID,
    runtime: RuntimeDependency,
) -> dict[str, object]:
    learner, rows = await _model_rows(runtime, learner_id)
    learner_node = {
        "data": {
            "id": str(learner.id),
            "type": "Learner",
            "label": learner.display_name,
        }
    }
    state_nodes = [
        {
            "data": {
                "id": f"{learner.id}:{row['knowledge_point_id']}",
                "type": "LearnerKnowledgeState",
                "knowledge_point_id": row["knowledge_point_id"],
                "label": row["knowledge_point"],
                "current_level": row["current_level"],
                "mastery_score": row["mastery_score"],
            }
        }
        for row in rows
    ]
    edges = [
        {
            "data": {
                "id": f"state:{learner.id}:{row['knowledge_point_id']}",
                "source": str(learner.id),
                "target": f"{learner.id}:{row['knowledge_point_id']}",
                "relation_type": "HAS_KNOWLEDGE_STATE",
            }
        }
        for row in rows
    ]
    return {
        "elements": {"nodes": [learner_node, *state_nodes], "edges": edges},
        "meta": {"projection": "learner-state-only"},
    }


@router.get("/learners/{learner_id}/learning-path")
async def get_learning_path(
    learner_id: UUID,
    runtime: RuntimeDependency,
    target_knowledge_point_id: UUID | None = Query(default=None),
) -> dict[str, object]:
    learner, rows = await _model_rows(runtime, learner_id)
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
    limit: int = Query(default=100, ge=1, le=1000),
) -> dict[str, object]:
    async with runtime.database.unit_of_work() as unit:
        if await unit.learners.get(learner_id) is None:
            raise HTTPException(status_code=404, detail="learner not found")
        evidence = await unit.learner_states.list_evidence(learner_id, limit=limit)
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
) -> tuple[LearnerRecord, list[dict[str, object]]]:
    async with runtime.database.unit_of_work() as unit:
        learner = await unit.learners.get(learner_id)
        if learner is None:
            raise HTTPException(status_code=404, detail="learner not found")
        states = await unit.learner_states.list_states(learner_id)
    snapshot = await runtime.ensure_graph_loaded(learner.workspace_id)
    nodes = snapshot.node_map()
    prerequisite_map = {
        assertion.subject_id: assertion.object_id
        for assertion in snapshot.assertions
        if assertion.is_active and assertion.predicate_key.value == "REQUIRES"
    }
    state_by_point = {item.knowledge_point_id: item for item in states}
    rows: list[dict[str, object]] = []
    for item in states:
        node = nodes.get(item.knowledge_point_id)
        name = str(
            (node.properties.get("display_name") if node else None)
            or (node.properties.get("canonical_name") if node else None)
            or item.knowledge_point_id
        )
        prerequisite_id = prerequisite_map.get(item.knowledge_point_id)
        prerequisite_state = state_by_point.get(prerequisite_id) if prerequisite_id else None
        rows.append(
            {
                "knowledge_point_id": str(item.knowledge_point_id),
                "knowledge_point": name,
                "current_level": item.current_level,
                "mastery_score": item.mastery_score,
                "confidence": item.confidence,
                "evidence_count": item.evidence_count,
                "critical_misconceptions": item.critical_misconceptions,
                "prerequisite_status": (
                    "mastered"
                    if prerequisite_state and prerequisite_state.mastery_score >= 0.75
                    else "not_mastered"
                    if prerequisite_id
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


def _csv_safe_value(value: object) -> object:
    """Prevent spreadsheet programs from interpreting learner-controlled text as formulas."""

    if not isinstance(value, str):
        return value
    candidate = value.lstrip()
    if candidate.startswith(("=", "+", "-", "@", "\t", "\r")):
        return f"'{value}"
    return value
