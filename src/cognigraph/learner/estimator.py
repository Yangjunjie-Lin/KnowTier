from __future__ import annotations

from typing import Protocol

from cognigraph.domain.learner import LearnerKnowledgeState, MasteryEvidence, MasteryUpdate


class MasteryEstimator(Protocol):
    async def update(
        self,
        current_state: LearnerKnowledgeState,
        evidence: MasteryEvidence,
    ) -> MasteryUpdate: ...
