from __future__ import annotations

import json
from uuid import UUID

from cognigraph.domain.base import JsonObject
from cognigraph.domain.enums import CognitiveLevel, EvidenceType, HintLevel
from cognigraph.domain.learner import MasteryEvidence
from cognigraph.llm.gateway import ModelGateway
from cognigraph.llm.schemas import ChatMessage, GraderOutput, ModelCallContext, ModelRole
from cognigraph.prompts import PromptManager


class ResponseEvaluator:
    def __init__(self, gateway: ModelGateway, prompts: PromptManager | None = None) -> None:
        self.gateway = gateway
        self.prompts = prompts or PromptManager()

    async def evaluate(
        self,
        *,
        workspace_id: UUID,
        learner_id: UUID,
        knowledge_point_id: UUID,
        session_id: UUID,
        turn_id: UUID,
        cognitive_level: CognitiveLevel,
        question: str,
        rubric: list[str],
        raw_answer: str,
        evidence_type: EvidenceType,
        source_supported_definition: str,
        must_cover: list[str],
        learning_objective: str,
        teaching_strategy: str,
        hint_level: HintLevel,
        supporting_sources: list[JsonObject],
        graph_revision_id: UUID | None = None,
    ) -> MasteryEvidence:
        if evidence_type is EvidenceType.SELF_REPORT:
            return MasteryEvidence(
                learner_id=learner_id,
                knowledge_point_id=knowledge_point_id,
                session_id=session_id,
                turn_id=turn_id,
                evidence_type=evidence_type,
                cognitive_level=cognitive_level,
                correctness_score=0.0,
                reasoning_score=0.0,
                independence_score=0.0,
                transfer_score=0.0,
                grader_confidence=1.0,
                raw_answer=raw_answer,
                grader_explanation=(
                    "The message is a pure self-report and supplies no observable mastery evidence."
                ),
            )

        prompt = self.prompts.load("response_grader")
        grading_payload = {
            "assessment": {
                "question": question,
                "rubric": rubric,
                "cognitive_level": int(cognitive_level),
                "evidence_type": evidence_type.value,
            },
            "source_grounded_context": {
                "definition": source_supported_definition,
                "must_cover": must_cover,
                "learning_objective": learning_objective,
                "teaching_strategy": teaching_strategy,
                "supporting_sources": supporting_sources,
            },
            "assistance_context": {
                "hint_level": int(hint_level),
                "independence_rule": (
                    "Score independence in light of the disclosed hint level; do not infer "
                    "unassisted success after a strong hint."
                ),
            },
            "untrusted_learner_answer": raw_answer,
        }
        grade, _result = await self.gateway.generate_structured(
            role=ModelRole.GRADER,
            messages=[
                ChatMessage(role="system", content=prompt.content),
                ChatMessage(
                    role="user",
                    content=json.dumps(
                        grading_payload,
                        ensure_ascii=False,
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                ),
            ],
            response_model=GraderOutput,
            context=ModelCallContext(
                workspace_id=workspace_id,
                learner_id=learner_id,
                session_id=session_id,
                turn_id=turn_id,
                graph_revision_id=graph_revision_id,
                prompt_name=prompt.name,
                prompt_version=prompt.version,
            ),
        )
        return MasteryEvidence(
            learner_id=learner_id,
            knowledge_point_id=knowledge_point_id,
            session_id=session_id,
            turn_id=turn_id,
            evidence_type=evidence_type,
            cognitive_level=cognitive_level,
            correctness_score=grade.correctness,
            reasoning_score=grade.reasoning,
            independence_score=grade.independence,
            transfer_score=grade.transfer,
            grader_confidence=grade.confidence,
            observed_misconceptions=grade.misconceptions,
            raw_answer=raw_answer,
            grader_explanation=grade.explanation,
        )
