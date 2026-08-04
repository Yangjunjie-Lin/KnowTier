from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import timedelta

from cognigraph.domain.base import JsonObject, JsonValue, utc_now
from cognigraph.domain.enums import CognitiveLevel, MasteryDecision
from cognigraph.domain.learner import LearnerKnowledgeState, MasteryEvidence, MasteryUpdate


@dataclass(frozen=True, slots=True)
class EvidenceRulePolicy:
    correctness_threshold: float = 0.75
    reasoning_threshold: float = 0.65
    independence_threshold: float = 0.65
    remediation_threshold: float = 0.35
    minimum_distinct_turns: int = 2
    minimum_evidence_forms: int = 2
    review_interval_days: int = 2


class EvidenceRuleEstimator:
    """Explainable mastery estimator; callers supply persisted evidence history."""

    def __init__(
        self,
        history: Sequence[MasteryEvidence] = (),
        *,
        policy: EvidenceRulePolicy | None = None,
    ) -> None:
        self.history = tuple(history)
        self.policy = policy or EvidenceRulePolicy()

    async def update(
        self,
        current_state: LearnerKnowledgeState,
        evidence: MasteryEvidence,
    ) -> MasteryUpdate:
        self._validate_identity(current_state, evidence)
        relevant = [
            item
            for item in (*self.history, evidence)
            if item.learner_id == current_state.learner_id
            and item.knowledge_point_id == current_state.knowledge_point_id
            and item.cognitive_level == current_state.current_level
            and not item.is_self_report_only
        ]
        correctness = self._weighted_average(relevant, "correctness_score")
        reasoning = self._weighted_average(relevant, "reasoning_score")
        independence = self._weighted_average(relevant, "independence_score")
        transfer = self._weighted_average(relevant, "transfer_score")
        turns = {item.turn_id for item in relevant}
        forms = {item.evidence_type for item in relevant}
        misconceptions = self._unresolved_misconceptions(current_state, relevant)

        promotion_eligible = all(
            (
                current_state.current_level < CognitiveLevel.CREATION_RESEARCH,
                len(turns) >= self.policy.minimum_distinct_turns,
                len(forms) >= self.policy.minimum_evidence_forms,
                correctness >= self.policy.correctness_threshold,
                reasoning >= self.policy.reasoning_threshold,
                independence >= self.policy.independence_threshold,
                not misconceptions,
                bool(relevant),
            )
        )
        decision, reason = self._decision(
            evidence=evidence,
            relevant=relevant,
            promotion_eligible=promotion_eligible,
            correctness=correctness,
            reasoning=reasoning,
            misconceptions=misconceptions,
        )
        now = utc_now()
        next_level = current_state.current_level
        if promotion_eligible and current_state.current_level < CognitiveLevel.CREATION_RESEARCH:
            next_level = CognitiveLevel(current_state.current_level + 1)
        updated = current_state.model_copy(
            update={
                "current_level": next_level,
                "mastery_score": round(correctness, 4),
                "confidence": round(self._confidence(relevant, evidence), 4),
                "evidence_count": current_state.evidence_count + 1,
                "independent_success_count": current_state.independent_success_count
                + int(evidence.independence_score >= self.policy.independence_threshold),
                "reasoning_success_count": current_state.reasoning_success_count
                + int(evidence.reasoning_score >= self.policy.reasoning_threshold),
                "transfer_success_count": current_state.transfer_success_count
                + int(evidence.transfer_score >= self.policy.correctness_threshold),
                "critical_misconceptions": misconceptions,
                "last_interaction_at": now,
                "next_review_at": now + timedelta(days=self.policy.review_interval_days),
                "version": current_state.version + 1,
                "updated_at": now,
            }
        )
        evidence_forms: list[JsonValue] = [item.value for item in sorted(forms, key=str)]
        machine_reason: JsonObject = {
            "distinct_turns": len(turns),
            "evidence_forms": evidence_forms,
            "aggregate_correctness": round(correctness, 4),
            "aggregate_reasoning": round(reasoning, 4),
            "aggregate_independence": round(independence, 4),
            "aggregate_transfer": round(transfer, 4),
            "unresolved_misconceptions": list(misconceptions),
        }
        return MasteryUpdate(
            decision=decision,
            reason=reason,
            updated_state=updated,
            applied_evidence_id=evidence.id,
            promotion_eligible=promotion_eligible,
            machine_reason=machine_reason,
        )

    @staticmethod
    def _validate_identity(
        state: LearnerKnowledgeState,
        evidence: MasteryEvidence,
    ) -> None:
        if evidence.learner_id != state.learner_id:
            raise ValueError("evidence learner does not match state")
        if evidence.knowledge_point_id != state.knowledge_point_id:
            raise ValueError("evidence knowledge point does not match state")

    @staticmethod
    def _weighted_average(evidence: Sequence[MasteryEvidence], field: str) -> float:
        weights = [item.grader_confidence for item in evidence]
        total = sum(weights)
        if total == 0:
            return 0.0
        weighted = sum(
            float(getattr(item, field)) * weight
            for item, weight in zip(evidence, weights, strict=True)
        )
        return weighted / total

    @staticmethod
    def _confidence(evidence: Sequence[MasteryEvidence], latest: MasteryEvidence) -> float:
        if not evidence:
            return min(latest.grader_confidence * 0.25, 1.0)
        diversity = min(len({item.evidence_type for item in evidence}) / 2, 1.0)
        volume = min(len({item.turn_id for item in evidence}) / 3, 1.0)
        grader = sum(item.grader_confidence for item in evidence) / len(evidence)
        return min((grader * 0.5) + (diversity * 0.25) + (volume * 0.25), 1.0)

    @staticmethod
    def _unresolved_misconceptions(
        state: LearnerKnowledgeState,
        evidence: Sequence[MasteryEvidence],
    ) -> list[str]:
        unresolved = set(state.critical_misconceptions)
        for item in evidence:
            unresolved.update(item.observed_misconceptions)
        # A strong answer may resolve only misconceptions that the grader explanation
        # explicitly addresses.  One generic high score must never erase unrelated flags.
        if evidence:
            latest = evidence[-1]
            if (
                not latest.observed_misconceptions
                and latest.correctness_score >= 0.85
                and latest.reasoning_score >= 0.8
            ):
                explanation = latest.grader_explanation.casefold()
                unresolved = {item for item in unresolved if item.casefold() not in explanation}
        return sorted(unresolved)

    def _decision(
        self,
        *,
        evidence: MasteryEvidence,
        relevant: Sequence[MasteryEvidence],
        promotion_eligible: bool,
        correctness: float,
        reasoning: float,
        misconceptions: list[str],
    ) -> tuple[MasteryDecision, str]:
        if evidence.is_self_report_only:
            return (
                MasteryDecision.REQUEST_MORE_EVIDENCE,
                "Self-report alone cannot establish mastery.",
            )
        if (
            evidence.cognitive_level is CognitiveLevel.CREATION_RESEARCH
            and correctness >= self.policy.correctness_threshold
            and reasoning >= self.policy.reasoning_threshold
            and not misconceptions
        ):
            return (
                MasteryDecision.HOLD,
                "Highest-level evidence was recorded; there is no level above six.",
            )
        if promotion_eligible:
            return (
                MasteryDecision.PROMOTE,
                "Independent, reasoned evidence from multiple turns and forms "
                "meets promotion rules.",
            )
        if misconceptions:
            return MasteryDecision.REMEDIATE, "A critical misconception remains unresolved."
        if evidence.correctness_score < self.policy.remediation_threshold:
            return (
                MasteryDecision.CHANGE_EXPLANATION,
                "Latest evidence indicates the explanation did not establish the concept.",
            )
        if (
            correctness >= self.policy.correctness_threshold
            and reasoning < self.policy.reasoning_threshold
        ):
            return (
                MasteryDecision.HOLD,
                "The answer is mostly correct, but its reasoning is not yet reliable.",
            )
        if len(relevant) < self.policy.minimum_distinct_turns:
            return (
                MasteryDecision.REQUEST_MORE_EVIDENCE,
                "Another valid response from a different turn is required.",
            )
        return (
            MasteryDecision.HOLD,
            "Current evidence is useful but does not meet every promotion requirement.",
        )
