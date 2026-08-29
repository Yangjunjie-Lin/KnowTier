"""Deterministic next-best-action planning for a learner."""

from __future__ import annotations

from collections import Counter
from collections.abc import Collection, Sequence
from datetime import UTC, datetime

from cognigraph.domain.enums import CognitiveLevel, RequestedMode
from cognigraph.domain.learning_plan import (
    LearningPhase,
    LearningPlan,
    LearningPlanRecommendation,
    LearningPlanStep,
    LearningPlanSummary,
    LearningPlanTopic,
    LearningPriority,
)

_PRIORITY_ORDER: dict[LearningPriority, int] = {
    LearningPriority.CORRECT_MISCONCEPTION: 0,
    LearningPriority.REVIEW_DUE: 1,
    LearningPriority.UNLOCK_PREREQUISITE: 2,
    LearningPriority.REMEDIATE_FOUNDATION: 3,
    LearningPriority.CONTINUE_PRACTICE: 4,
    LearningPriority.START_TOPIC: 5,
    LearningPriority.DEEPEN_MASTERY: 6,
}


def build_learning_plan(
    topics: Sequence[LearningPlanTopic],
    *,
    now: datetime | None = None,
    goal_knowledge_point_id: object | None = None,
    eligible_topic_ids: Collection[object] | None = None,
) -> LearningPlan:
    """Rank ready topics and construct a short, evidence-producing session.

    The planner uses only persisted learner state and application-validated graph
    structure. It does not ask a model to invent facts or relationships.
    """

    current_time = (now or datetime.now(UTC)).astimezone(UTC)
    topic_by_id = {topic.knowledge_point_id: topic for topic in topics}
    mastered_ids = {topic.knowledge_point_id for topic in topics if _is_mastered(topic)}
    allowed_ids = (
        {topic_id for topic_id in topic_by_id if topic_id in eligible_topic_ids}
        if eligible_topic_ids is not None
        else set(topic_by_id)
    )
    blockers_by_id = {
        topic.knowledge_point_id: [
            prerequisite_id
            for prerequisite_id in topic.prerequisite_ids
            if prerequisite_id not in mastered_ids
        ]
        for topic in topics
    }
    unlock_counts = Counter(
        prerequisite_id
        for topic in topics
        if topic.knowledge_point_id in allowed_ids
        for prerequisite_id in blockers_by_id[topic.knowledge_point_id]
    )

    candidates: list[LearningPlanRecommendation] = []
    for topic in topics:
        if topic.knowledge_point_id not in allowed_ids:
            continue
        blockers = blockers_by_id[topic.knowledge_point_id]
        # A blocked goal is never recommended directly. Its ready prerequisite
        # receives an unlock priority through ``unlock_counts`` instead.
        if blockers:
            continue
        priority = _priority_for(topic, current_time, unlock_counts[topic.knowledge_point_id])
        candidates.append(
            LearningPlanRecommendation(
                knowledge_point_id=topic.knowledge_point_id,
                knowledge_point=topic.knowledge_point,
                priority=priority,
                requested_mode=_mode_for(priority),
                current_level=topic.current_level,
                target_level=_target_level(topic),
                mastery_score=topic.mastery_score,
                confidence=topic.confidence,
                evidence_count=topic.evidence_count,
                misconception_count=topic.misconception_count,
                due_at=topic.next_review_at if _is_due(topic, current_time) else None,
                unlocks_topic_count=unlock_counts[topic.knowledge_point_id],
            )
        )

    candidates.sort(
        key=lambda candidate: _candidate_sort_key(
            candidate,
            topic_by_id[candidate.knowledge_point_id],
        )
    )
    focus = candidates[0] if candidates else None
    steps = _steps_for(focus)
    goal_id = goal_knowledge_point_id if goal_knowledge_point_id in topic_by_id else None
    return LearningPlan(
        goal_knowledge_point_id=goal_id,
        focus=focus,
        alternatives=candidates[1:3],
        steps=steps,
        total_minutes=sum(step.minutes for step in steps),
        summary=LearningPlanSummary(
            due_review_count=sum(_is_due(topic, current_time) for topic in topics),
            active_misconception_count=sum(topic.misconception_count for topic in topics),
            ready_topic_count=sum(not blockers_by_id[topic.knowledge_point_id] for topic in topics),
            blocked_topic_count=sum(
                bool(blockers_by_id[topic.knowledge_point_id]) for topic in topics
            ),
        ),
    )


def _is_mastered(topic: LearningPlanTopic) -> bool:
    return topic.mastery_score >= 0.75 and (topic.current_level or 1) >= 2


def _is_due(topic: LearningPlanTopic, now: datetime) -> bool:
    if topic.next_review_at is None:
        return False
    due_at = topic.next_review_at
    if due_at.tzinfo is None:
        due_at = due_at.replace(tzinfo=UTC)
    return due_at <= now


def _priority_for(
    topic: LearningPlanTopic,
    now: datetime,
    unlock_count: int,
) -> LearningPriority:
    if topic.misconception_count:
        return LearningPriority.CORRECT_MISCONCEPTION
    if _is_due(topic, now):
        return LearningPriority.REVIEW_DUE
    if unlock_count and not _is_mastered(topic):
        return LearningPriority.UNLOCK_PREREQUISITE
    if topic.evidence_count and topic.mastery_score < 0.35:
        return LearningPriority.REMEDIATE_FOUNDATION
    if _is_mastered(topic) and topic.current_level is not CognitiveLevel.CREATION_RESEARCH:
        return LearningPriority.DEEPEN_MASTERY
    if topic.evidence_count or topic.mastery_score > 0:
        return LearningPriority.CONTINUE_PRACTICE
    if topic.current_level is None:
        return LearningPriority.START_TOPIC
    return LearningPriority.DEEPEN_MASTERY


def _mode_for(priority: LearningPriority) -> RequestedMode:
    if priority in {
        LearningPriority.CORRECT_MISCONCEPTION,
        LearningPriority.REVIEW_DUE,
        LearningPriority.REMEDIATE_FOUNDATION,
    }:
        return RequestedMode.REVIEW
    if priority in {
        LearningPriority.UNLOCK_PREREQUISITE,
        LearningPriority.CONTINUE_PRACTICE,
        LearningPriority.DEEPEN_MASTERY,
    }:
        return RequestedMode.PRACTICE
    return RequestedMode.LEARN


def _target_level(topic: LearningPlanTopic) -> CognitiveLevel:
    if topic.current_level is None:
        return CognitiveLevel.INTUITIVE_RECOGNITION
    if topic.mastery_score >= 0.75 and topic.current_level < CognitiveLevel.CREATION_RESEARCH:
        return CognitiveLevel(topic.current_level + 1)
    return topic.current_level


def _candidate_sort_key(
    candidate: LearningPlanRecommendation,
    topic: LearningPlanTopic,
) -> tuple[int, float, int, float, int, str]:
    due_timestamp = candidate.due_at.timestamp() if candidate.due_at is not None else float("inf")
    return (
        _PRIORITY_ORDER[candidate.priority],
        due_timestamp,
        -candidate.unlocks_topic_count,
        candidate.mastery_score,
        topic.source_order,
        candidate.knowledge_point.casefold(),
    )


def _steps_for(
    focus: LearningPlanRecommendation | None,
) -> list[LearningPlanStep]:
    if focus is None:
        return []
    build_strategy = {
        LearningPriority.CORRECT_MISCONCEPTION: "contrast_and_correct",
        LearningPriority.REVIEW_DUE: "spaced_retrieval",
        LearningPriority.UNLOCK_PREREQUISITE: "prerequisite_scaffold",
        LearningPriority.REMEDIATE_FOUNDATION: "worked_example",
        LearningPriority.CONTINUE_PRACTICE: "guided_practice",
        LearningPriority.START_TOPIC: "conceptual_bridge",
        LearningPriority.DEEPEN_MASTERY: "transfer_challenge",
    }[focus.priority]
    return [
        LearningPlanStep(
            phase=LearningPhase.ACTIVATE,
            minutes=3,
            strategy="retrieval_warmup",
            requested_mode=RequestedMode.REVIEW,
        ),
        LearningPlanStep(
            phase=LearningPhase.BUILD,
            minutes=12,
            strategy=build_strategy,
            requested_mode=focus.requested_mode,
        ),
        LearningPlanStep(
            phase=LearningPhase.CHECK,
            minutes=5,
            strategy="independent_mastery_check",
            requested_mode=RequestedMode.EXAM,
        ),
    ]
