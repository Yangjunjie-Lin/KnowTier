from __future__ import annotations

from uuid import uuid4

import pytest

from cognigraph.domain.enums import CognitiveLevel, EvidenceType, MasteryDecision
from cognigraph.domain.learner import LearnerKnowledgeState, MasteryEvidence
from cognigraph.learner.bkt_estimator import BKTMasteryEstimator, BKTParameters
from cognigraph.learner.rule_estimator import EvidenceRuleEstimator


def evidence(
    state: LearnerKnowledgeState,
    *,
    turn_id=None,
    evidence_type: EvidenceType = EvidenceType.EXPLANATION,
    correctness: float = 0.9,
    reasoning: float = 0.85,
    independence: float = 0.85,
    misconceptions: list[str] | None = None,
) -> MasteryEvidence:
    return MasteryEvidence(
        learner_id=state.learner_id,
        knowledge_point_id=state.knowledge_point_id,
        session_id=uuid4(),
        turn_id=turn_id or uuid4(),
        evidence_type=evidence_type,
        cognitive_level=state.current_level,
        correctness_score=correctness,
        reasoning_score=reasoning,
        independence_score=independence,
        transfer_score=0.5,
        grader_confidence=0.9,
        observed_misconceptions=misconceptions or [],
        raw_answer="A reasoned learner answer",
        grader_explanation="Scored against the stage rubric.",
    )


def state() -> LearnerKnowledgeState:
    return LearnerKnowledgeState(learner_id=uuid4(), knowledge_point_id=uuid4())


@pytest.mark.asyncio
async def test_rule_estimator_requires_two_turns_and_forms() -> None:
    current = state()
    first = evidence(current, evidence_type=EvidenceType.RECOGNITION)
    update = await EvidenceRuleEstimator().update(current, first)
    assert update.decision is MasteryDecision.REQUEST_MORE_EVIDENCE
    assert update.updated_state.current_level is CognitiveLevel.INTUITIVE_RECOGNITION

    second = evidence(current, evidence_type=EvidenceType.EXPLANATION)
    promoted = await EvidenceRuleEstimator([first]).update(current, second)
    assert promoted.decision is MasteryDecision.PROMOTE
    assert promoted.updated_state.current_level is CognitiveLevel.GUIDED_IMITATION


@pytest.mark.asyncio
async def test_rule_estimator_never_promotes_self_report() -> None:
    current = state()
    self_report = evidence(current, evidence_type=EvidenceType.SELF_REPORT)
    update = await EvidenceRuleEstimator().update(current, self_report)
    assert update.decision is MasteryDecision.REQUEST_MORE_EVIDENCE
    assert not update.promotion_eligible


@pytest.mark.asyncio
async def test_rule_estimator_remediates_misconception() -> None:
    current = state()
    item = evidence(current, correctness=0.6, misconceptions=["confuses cause with correlation"])
    update = await EvidenceRuleEstimator().update(current, item)
    assert update.decision is MasteryDecision.REMEDIATE
    assert update.updated_state.critical_misconceptions


@pytest.mark.asyncio
async def test_bkt_update_matches_four_parameter_equation() -> None:
    current = state()
    params = BKTParameters(
        initial_mastery=0.2,
        learn_probability=0.1,
        guess_probability=0.2,
        slip_probability=0.1,
        promotion_threshold=0.99,
    )
    update = await BKTMasteryEstimator(params).update(current, evidence(current))
    # Correct posterior: .18 / (.18 + .16) then a 0.1 learning transition.
    expected = (0.18 / 0.34) + ((1 - (0.18 / 0.34)) * 0.1)
    assert update.updated_state.mastery_score == pytest.approx(expected, abs=1e-6)
    assert update.decision is MasteryDecision.HOLD


def test_bkt_parameters_are_bounded() -> None:
    with pytest.raises(ValueError, match="guess_probability"):
        BKTParameters(guess_probability=1.1)
