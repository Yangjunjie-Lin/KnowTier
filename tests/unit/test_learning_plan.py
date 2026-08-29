from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from cognigraph.domain.enums import CognitiveLevel, RequestedMode
from cognigraph.domain.learning_plan import LearningPlanTopic, LearningPriority
from cognigraph.services.learning_plan import build_learning_plan


def test_plan_prioritizes_misconception_then_due_review() -> None:
    now = datetime(2026, 8, 29, tzinfo=UTC)
    misconception_id = uuid4()
    due_id = uuid4()
    plan = build_learning_plan(
        [
            LearningPlanTopic(
                knowledge_point_id=due_id,
                knowledge_point="Due topic",
                current_level=CognitiveLevel.CONCEPTUAL_UNDERSTANDING,
                mastery_score=0.8,
                evidence_count=3,
                next_review_at=now - timedelta(days=2),
            ),
            LearningPlanTopic(
                knowledge_point_id=misconception_id,
                knowledge_point="Misunderstood topic",
                current_level=CognitiveLevel.GUIDED_IMITATION,
                mastery_score=0.4,
                evidence_count=2,
                misconception_count=1,
            ),
        ],
        now=now,
    )

    assert plan.focus is not None
    assert plan.focus.knowledge_point_id == misconception_id
    assert plan.focus.priority is LearningPriority.CORRECT_MISCONCEPTION
    assert plan.focus.requested_mode is RequestedMode.REVIEW
    assert plan.alternatives[0].knowledge_point_id == due_id
    assert [step.minutes for step in plan.steps] == [3, 12, 5]


def test_plan_recommends_ready_prerequisite_instead_of_blocked_goal() -> None:
    prerequisite_id = uuid4()
    goal_id = uuid4()
    plan = build_learning_plan(
        [
            LearningPlanTopic(
                knowledge_point_id=goal_id,
                knowledge_point="Goal",
                prerequisite_ids=[prerequisite_id],
                source_order=1,
            ),
            LearningPlanTopic(
                knowledge_point_id=prerequisite_id,
                knowledge_point="Foundation",
                source_order=0,
            ),
        ],
        goal_knowledge_point_id=goal_id,
        eligible_topic_ids={goal_id, prerequisite_id},
    )

    assert plan.focus is not None
    assert plan.focus.knowledge_point_id == prerequisite_id
    assert plan.focus.priority is LearningPriority.UNLOCK_PREREQUISITE
    assert plan.focus.unlocks_topic_count == 1
    assert plan.summary.blocked_topic_count == 1


def test_plan_is_empty_when_no_topics_are_available() -> None:
    plan = build_learning_plan([])

    assert plan.focus is None
    assert plan.steps == []
    assert plan.total_minutes == 0
