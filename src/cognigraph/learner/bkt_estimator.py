from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from cognigraph.domain.base import JsonObject, utc_now
from cognigraph.domain.enums import CognitiveLevel, MasteryDecision
from cognigraph.domain.learner import LearnerKnowledgeState, MasteryEvidence, MasteryUpdate


@dataclass(frozen=True, slots=True)
class BKTParameters:
    initial_mastery: float = 0.2
    learn_probability: float = 0.1
    guess_probability: float = 0.2
    slip_probability: float = 0.1
    promotion_threshold: float = 0.95

    def __post_init__(self) -> None:
        for name, value in (
            ("initial_mastery", self.initial_mastery),
            ("learn_probability", self.learn_probability),
            ("guess_probability", self.guess_probability),
            ("slip_probability", self.slip_probability),
            ("promotion_threshold", self.promotion_threshold),
        ):
            if not 0 <= value <= 1:
                raise ValueError(f"{name} must be between zero and one")


class BKTMasteryEstimator:
    def __init__(self, parameters: BKTParameters | None = None) -> None:
        self.parameters = parameters or BKTParameters()

    async def update(
        self,
        current_state: LearnerKnowledgeState,
        evidence: MasteryEvidence,
    ) -> MasteryUpdate:
        if (
            evidence.learner_id != current_state.learner_id
            or evidence.knowledge_point_id != current_state.knowledge_point_id
        ):
            raise ValueError("evidence identity does not match learner state")
        now = utc_now()
        if evidence.is_self_report_only:
            updated = current_state.model_copy(
                update={
                    "evidence_count": current_state.evidence_count + 1,
                    "last_interaction_at": now,
                    "next_review_at": now + timedelta(days=2),
                    "version": current_state.version + 1,
                    "updated_at": now,
                }
            )
            return MasteryUpdate(
                decision=MasteryDecision.REQUEST_MORE_EVIDENCE,
                reason="Self-report alone cannot update BKT mastery or promote a learner.",
                updated_state=updated,
                applied_evidence_id=evidence.id,
                promotion_eligible=False,
                machine_reason={"ignored_observation": "SELF_REPORT"},
            )
        prior = (
            current_state.mastery_score
            if current_state.evidence_count
            else self.parameters.initial_mastery
        )
        observed_correct = evidence.correctness_score >= 0.5
        if observed_correct:
            numerator = prior * (1 - self.parameters.slip_probability)
            denominator = numerator + ((1 - prior) * self.parameters.guess_probability)
        else:
            numerator = prior * self.parameters.slip_probability
            denominator = numerator + ((1 - prior) * (1 - self.parameters.guess_probability))
        posterior = numerator / denominator if denominator else prior
        learned = posterior + ((1 - posterior) * self.parameters.learn_probability)
        promotion_eligible = (
            current_state.current_level < CognitiveLevel.CREATION_RESEARCH
            and learned >= self.parameters.promotion_threshold
            and evidence.reasoning_score >= 0.65
            and evidence.independence_score >= 0.65
            and not evidence.observed_misconceptions
        )
        decision = MasteryDecision.PROMOTE if promotion_eligible else MasteryDecision.HOLD
        level = current_state.current_level
        if promotion_eligible and level < CognitiveLevel.CREATION_RESEARCH:
            level = CognitiveLevel(level + 1)
        updated = current_state.model_copy(
            update={
                "current_level": level,
                "mastery_score": round(learned, 6),
                "confidence": min(
                    current_state.confidence + (0.1 * evidence.grader_confidence), 1.0
                ),
                "evidence_count": current_state.evidence_count + 1,
                "independent_success_count": current_state.independent_success_count
                + int(evidence.independence_score >= 0.65),
                "reasoning_success_count": current_state.reasoning_success_count
                + int(evidence.reasoning_score >= 0.65),
                "transfer_success_count": current_state.transfer_success_count
                + int(evidence.transfer_score >= 0.75),
                "critical_misconceptions": sorted(
                    set(current_state.critical_misconceptions)
                    | set(evidence.observed_misconceptions)
                ),
                "last_interaction_at": now,
                "next_review_at": now + timedelta(days=2),
                "version": current_state.version + 1,
                "updated_at": now,
            }
        )
        if promotion_eligible:
            reason = "BKT posterior meets the promotion threshold."
        elif current_state.current_level is CognitiveLevel.CREATION_RESEARCH:
            reason = "Highest-level evidence was recorded; there is no level above six."
        else:
            reason = "BKT posterior remains below the promotion threshold."
        machine_reason: JsonObject = {
            "prior": prior,
            "posterior_after_observation": posterior,
            "posterior_after_learning": learned,
            "observed_correct": observed_correct,
            "parameters": {
                "initial_mastery": self.parameters.initial_mastery,
                "learn_probability": self.parameters.learn_probability,
                "guess_probability": self.parameters.guess_probability,
                "slip_probability": self.parameters.slip_probability,
            },
        }
        return MasteryUpdate(
            decision=decision,
            reason=reason,
            updated_state=updated,
            applied_evidence_id=evidence.id,
            promotion_eligible=promotion_eligible,
            machine_reason=machine_reason,
        )
