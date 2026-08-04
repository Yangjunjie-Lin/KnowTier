from __future__ import annotations

from dataclasses import dataclass

from cognigraph.domain.enums import AssessmentType, CognitiveLevel, TeachingAction


@dataclass(frozen=True, slots=True)
class LevelPolicy:
    action: TeachingAction
    assessment_type: AssessmentType
    objective: str
    constraints: tuple[str, ...]


LEVEL_POLICIES: dict[CognitiveLevel, LevelPolicy] = {
    CognitiveLevel.INTUITIVE_RECOGNITION: LevelPolicy(
        action=TeachingAction.EXPLAIN_INTUITIVELY,
        assessment_type=AssessmentType.RECOGNIZE,
        objective="Recognize and describe the idea in everyday language.",
        constraints=("use one concrete analogy", "minimize terminology"),
    ),
    CognitiveLevel.GUIDED_IMITATION: LevelPolicy(
        action=TeachingAction.DEMONSTRATE,
        assessment_type=AssessmentType.REPRODUCE_PROCEDURE,
        objective="Follow a demonstrated pattern on a closely related task.",
        constraints=("show explicit steps", "ask one structurally similar exercise"),
    ),
    CognitiveLevel.CONCEPTUAL_UNDERSTANDING: LevelPolicy(
        action=TeachingAction.EXPLAIN_CAUSALLY,
        assessment_type=AssessmentType.EXPLAIN_REASON,
        objective="Explain why the method works and distinguish a close alternative.",
        constraints=("explain causality", "include one failing alternative"),
    ),
    CognitiveLevel.INDEPENDENT_APPLICATION: LevelPolicy(
        action=TeachingAction.GUIDE_APPLICATION,
        assessment_type=AssessmentType.APPLY,
        objective="Choose and apply the idea independently in a new problem.",
        constraints=("provide a framework only", "leave the core inference to the learner"),
    ),
    CognitiveLevel.CRITICAL_TRANSFER: LevelPolicy(
        action=TeachingAction.CHALLENGE_WITH_BOUNDARY,
        assessment_type=AssessmentType.ANALYZE_BOUNDARY,
        objective="Judge boundaries, assumptions, counterexamples and alternatives.",
        constraints=("use one boundary case", "ask for an assumption or alternative"),
    ),
    CognitiveLevel.CREATION_RESEARCH: LevelPolicy(
        action=TeachingAction.FORMULATE_RESEARCH_QUESTION,
        assessment_type=AssessmentType.DESIGN_RESEARCH,
        objective="Form a falsifiable proposal and a credible validation design.",
        constraints=("require a baseline and metric", "require a failure criterion"),
    ),
}


def policy_for(level: CognitiveLevel) -> LevelPolicy:
    return LEVEL_POLICIES[level]
