from __future__ import annotations

from collections.abc import Mapping
from uuid import UUID

from cognigraph.domain.enums import (
    CognitiveLevel,
    HintLevel,
    MasteryDecision,
    TeachingAction,
)
from cognigraph.domain.learner import LearnerKnowledgeState, MasteryUpdate
from cognigraph.domain.teaching import SessionGoal, TeachingDirective
from cognigraph.tutoring.level_policy import policy_for


class TeachingController:
    """Deterministic state machine for one tutoring turn."""

    def decide(
        self,
        *,
        learner_state: LearnerKnowledgeState,
        current_knowledge_point_id: UUID,
        latest_update: MasteryUpdate | None,
        prerequisite_status: Mapping[UUID, bool],
        session_goal: SessionGoal,
        previous_hint_level: HintLevel | None = None,
    ) -> TeachingDirective:
        unmet = [item for item, mastered in prerequisite_status.items() if not mastered]
        if unmet:
            target_id = unmet[0]
            return TeachingDirective(
                teaching_action=TeachingAction.REVIEW_PREREQUISITE,
                target_knowledge_point_id=target_id,
                target_level=CognitiveLevel.INTUITIVE_RECOGNITION,
                response_constraints=self._common_constraints("review exactly one prerequisite"),
                assessment_type=policy_for(CognitiveLevel.INTUITIVE_RECOGNITION).assessment_type,
                hint_level=HintLevel.LEVEL_1_DIRECTION,
                promotion_eligibility=False,
            )

        level = learner_state.current_level
        target_id = session_goal.knowledge_point_id or current_knowledge_point_id
        policy = policy_for(level)
        action = policy.action
        hint = previous_hint_level or HintLevel.LEVEL_1_DIRECTION
        promotion = False
        constraints = list(policy.constraints)

        if latest_update is not None:
            promotion = latest_update.promotion_eligible
            if latest_update.decision is MasteryDecision.PROMOTE:
                level = latest_update.updated_state.current_level
                policy = policy_for(level)
                action = policy.action
                hint = HintLevel.LEVEL_1_DIRECTION
                constraints = list(policy.constraints)
            elif latest_update.decision in {
                MasteryDecision.REMEDIATE,
                MasteryDecision.CHANGE_EXPLANATION,
            }:
                action = TeachingAction.REMEDIATE
                hint = self.next_hint(previous_hint_level)
                constraints.append("do not reveal a full solution unless hint level is five")
            elif latest_update.decision is MasteryDecision.REVIEW_PREREQUISITE:
                action = TeachingAction.REVIEW_PREREQUISITE
            elif latest_update.decision is MasteryDecision.REQUEST_MORE_EVIDENCE:
                action = TeachingAction.GIVE_HINT
                hint = self.next_hint(previous_hint_level)
            else:
                action = TeachingAction.GIVE_HINT
                hint = self.next_hint(previous_hint_level)

        return TeachingDirective(
            teaching_action=action,
            target_knowledge_point_id=target_id,
            target_level=level,
            response_constraints=self._common_constraints(*constraints),
            assessment_type=policy.assessment_type,
            hint_level=hint,
            promotion_eligibility=promotion,
        )

    @staticmethod
    def next_hint(previous: HintLevel | None) -> HintLevel:
        if previous is None:
            return HintLevel.LEVEL_1_DIRECTION
        return HintLevel(min(int(previous) + 1, int(HintLevel.LEVEL_5_FULL_DEMONSTRATION)))

    @staticmethod
    def _common_constraints(*constraints: str) -> list[str]:
        return [
            "one primary cognitive objective",
            "exactly one mastery-check question",
            "use only the compiled context bundle",
            *constraints,
        ]
