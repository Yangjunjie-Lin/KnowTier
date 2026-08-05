from __future__ import annotations

from uuid import uuid4

from cognigraph.domain.enums import (
    AssessmentType,
    CognitiveLevel,
    HintLevel,
    MasteryDecision,
    TeachingAction,
)
from cognigraph.domain.learner import LearnerKnowledgeState, MasteryUpdate
from cognigraph.domain.teaching import SessionGoal
from cognigraph.tutoring.controller import TeachingController
from cognigraph.tutoring.level_policy import LEVEL_POLICIES


def test_every_level_has_a_distinct_policy() -> None:
    assert set(LEVEL_POLICIES) == set(CognitiveLevel)
    conceptual = LEVEL_POLICIES[CognitiveLevel.CONCEPTUAL_UNDERSTANDING]
    assert conceptual.assessment_type is AssessmentType.EXPLAIN_REASON


def test_unmet_prerequisite_is_selected_before_current_point() -> None:
    learner = uuid4()
    current = uuid4()
    prerequisite = uuid4()
    state = LearnerKnowledgeState(learner_id=learner, knowledge_point_id=current)
    directive = TeachingController().decide(
        learner_state=state,
        current_knowledge_point_id=current,
        latest_update=None,
        prerequisite_status={prerequisite: False},
        session_goal=SessionGoal(knowledge_point_id=current),
    )
    assert directive.teaching_action is TeachingAction.REVIEW_PREREQUISITE
    assert directive.target_knowledge_point_id == prerequisite


def test_multiple_prerequisites_use_the_deterministic_learner_priority() -> None:
    learner = uuid4()
    current = uuid4()
    unlearned = uuid4()
    low_mastery = uuid4()
    state = LearnerKnowledgeState(learner_id=learner, knowledge_point_id=current)
    directive = TeachingController().decide(
        learner_state=state,
        current_knowledge_point_id=current,
        latest_update=None,
        prerequisite_status={low_mastery: False, unlearned: False},
        prerequisite_priorities={
            # Existing but weak knowledge sorts after a never-studied prerequisite.
            low_mastery: (1, 0.1, 1, 0),
            unlearned: (0, 0.0, 1, 1),
        },
        session_goal=SessionGoal(knowledge_point_id=current),
    )
    assert directive.teaching_action is TeachingAction.REVIEW_PREREQUISITE
    assert directive.target_knowledge_point_id == unlearned


def test_lowest_mastery_breaks_tie_between_studied_prerequisites() -> None:
    learner = uuid4()
    current = uuid4()
    higher = uuid4()
    lower = uuid4()
    state = LearnerKnowledgeState(learner_id=learner, knowledge_point_id=current)
    directive = TeachingController().decide(
        learner_state=state,
        current_knowledge_point_id=current,
        latest_update=None,
        prerequisite_status={higher: False, lower: False},
        prerequisite_priorities={
            higher: (1, 0.6, 1, 0),
            lower: (1, 0.2, 1, 1),
        },
        session_goal=SessionGoal(knowledge_point_id=current),
    )
    assert directive.target_knowledge_point_id == lower


def test_hold_increases_hint_one_level() -> None:
    learner = uuid4()
    point = uuid4()
    state = LearnerKnowledgeState(learner_id=learner, knowledge_point_id=point)
    update = MasteryUpdate(
        decision=MasteryDecision.HOLD,
        reason="Needs another reasoned response.",
        updated_state=state,
        applied_evidence_id=uuid4(),
    )
    directive = TeachingController().decide(
        learner_state=state,
        current_knowledge_point_id=point,
        latest_update=update,
        prerequisite_status={},
        session_goal=SessionGoal(knowledge_point_id=point),
        previous_hint_level=HintLevel.LEVEL_2_MISSING_CONDITION,
    )
    assert directive.teaching_action is TeachingAction.GIVE_HINT
    assert directive.hint_level is HintLevel.LEVEL_3_STRUCTURE


def test_hint_level_is_capped_at_full_demonstration() -> None:
    next_hint = TeachingController.next_hint(HintLevel.LEVEL_5_FULL_DEMONSTRATION)
    assert next_hint is HintLevel.LEVEL_5_FULL_DEMONSTRATION
