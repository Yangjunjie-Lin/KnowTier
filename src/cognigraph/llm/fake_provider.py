from __future__ import annotations

import asyncio
import json
import re
from collections import deque
from typing import Any

from pydantic import BaseModel

from cognigraph.llm.gateway import ModelProvider
from cognigraph.llm.schemas import ChatMessage, ProviderResponse, ToolDefinition


class FakeProvider(ModelProvider):
    """Deterministic provider used by tests and the credential-free demo."""

    provider_name = "mock"

    def __init__(
        self,
        responses: list[str | BaseModel | ProviderResponse | Exception] | None = None,
        *,
        delay_seconds: float = 0.0,
        learning_insights_fixture: bool = False,
    ) -> None:
        self._responses: deque[str | BaseModel | ProviderResponse | Exception] = deque(
            responses or []
        )
        self.delay_seconds = delay_seconds
        self.learning_insights_fixture = learning_insights_fixture
        self.calls: list[tuple[str, list[ChatMessage], dict[str, Any]]] = []
        self.tool_calls: list[list[ToolDefinition]] = []

    async def complete(
        self,
        *,
        model: str,
        messages: list[ChatMessage],
        response_schema: dict[str, Any],
        tools: list[ToolDefinition] | None = None,
        tool_choice: str | dict[str, object] | None = None,
    ) -> ProviderResponse:
        self.calls.append((model, messages, response_schema))
        self.tool_calls.append(list(tools or ()))
        if self.delay_seconds:
            await asyncio.sleep(self.delay_seconds)
        item: str | BaseModel | ProviderResponse | Exception
        if self._responses:
            item = self._responses.popleft()
        else:
            item = self._default_payload(response_schema, messages)
        if isinstance(item, Exception):
            raise item
        if isinstance(item, ProviderResponse):
            return item.model_copy(
                update={
                    "provider": item.provider or self.provider_name,
                    "model": item.model or model,
                }
            )
        if isinstance(item, BaseModel):
            content = item.model_dump_json()
        else:
            content = item
        return ProviderResponse(content=content, provider=self.provider_name, model=model)

    def _default_payload(
        self,
        schema: dict[str, Any],
        messages: list[ChatMessage],
    ) -> str:
        properties = schema.get("properties", {})
        if "correctness" in properties:
            if self.learning_insights_fixture:
                fixture_grade = _learning_insights_grade(messages)
                if fixture_grade is not None:
                    return json.dumps(fixture_grade)
            return json.dumps(
                {
                    "correctness": 0.75,
                    "reasoning": 0.7,
                    "independence": 0.8,
                    "transfer": 0.2,
                    "misconceptions": [],
                    "confidence": 0.85,
                    "explanation": "The answer identifies the central idea and gives a reason.",
                }
            )
        if "assessment_question" in properties:
            return json.dumps(
                {
                    "core_explanation": (
                        "We will handle one idea at a time using the current evidence."
                    ),
                    "illustration": (
                        "Think of a prerequisite as a key needed before opening a door."
                    ),
                    "key_takeaway": (
                        "A new step is reliable only when its prerequisite is usable."
                    ),
                    "assessment_question": ("Which prerequisite would you check first, and why?"),
                }
            )
        if "core_explanation" in properties:
            return json.dumps(
                {
                    "acknowledgement": "Your question identifies the right focus.",
                    "core_explanation": (
                        "We will handle one idea at a time using the current evidence."
                    ),
                    "illustration": (
                        "Think of a prerequisite as a key needed before opening a door."
                    ),
                    "key_takeaway": "A new step is reliable only when its prerequisite is usable.",
                    "assessment": {
                        "type": "RECOGNIZE",
                        "question": "Which prerequisite would you check first, and why?",
                    },
                }
            )
        if {"canonical_name", "plain_definition"}.issubset(properties) and not {
            "formal_definition",
            "must_cover",
        }.intersection(properties):
            if _contains_rag_topic(messages):
                return json.dumps(
                    {
                        "canonical_name": "retrieval-augmented generation",
                        "plain_definition": (
                            "RAG retrieves relevant evidence before a language model "
                            "generates an answer grounded in that evidence."
                        ),
                    }
                )
            return json.dumps(
                {
                    "canonical_name": "source concept",
                    "plain_definition": "The central topic requested by the learner.",
                }
            )
        if {
            "canonical_name",
            "plain_definition",
            "formal_definition",
            "must_cover",
        }.issubset(properties):
            if _contains_rag_topic(messages):
                return json.dumps(
                    {
                        "title": "Retrieval-augmented generation",
                        "domain": "artificial intelligence",
                        "canonical_name": "retrieval-augmented generation",
                        "plain_definition": (
                            "RAG retrieves relevant evidence before a language model "
                            "generates an answer grounded in that evidence."
                        ),
                        "formal_definition": (
                            "A retrieval function supplies context to a conditional generator."
                        ),
                        "must_cover": ["retrieval", "grounded generation"],
                        "common_confusions": ["treating retrieval as model training"],
                        "applicability": ["question answering over external knowledge"],
                        "limitations": ["answer quality depends on retrieved evidence"],
                        "importance": 0.95,
                        "difficulty": 0.55,
                        "confidence": 0.8,
                    }
                )
            return json.dumps(
                {
                    "title": "Requested learning topic",
                    "domain": None,
                    "canonical_name": "source concept",
                    "plain_definition": "The central topic requested by the learner.",
                    "formal_definition": "An unverified atomic teaching objective.",
                    "must_cover": ["the requested topic"],
                    "common_confusions": [],
                    "applicability": ["the current learning request"],
                    "limitations": ["pending external evidence"],
                    "importance": 0.7,
                    "difficulty": 0.4,
                    "confidence": 0.6,
                }
            )
        if "knowledge_points" in properties:
            joined = "\n".join(_message_text(message) for message in messages)
            source_match = re.search(
                r"source_span(?:_id)?[=:\"'\s]+([0-9a-fA-F-]{36})",
                joined,
            )
            if source_match is None:
                source_match = re.search(
                    r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}",
                    joined,
                )
            source_id = (
                source_match.group(1)
                if source_match and source_match.lastindex
                else (
                    source_match.group(0)
                    if source_match
                    else "00000000-0000-0000-0000-000000000001"
                )
            )
            if self.learning_insights_fixture:
                return json.dumps(_learning_insights_blueprint(source_id))
            if _contains_rag_topic(messages):
                return json.dumps(_rag_blueprint(source_id))
            stages = [
                {
                    "cognitive_level": level,
                    "learning_objective": f"Demonstrate the source concept at level {level}.",
                    "teaching_strategy": f"Use the level {level} teaching policy.",
                    "must_cover": ["the source-supported central idea"],
                    "diagnostic_question": f"What shows level {level} understanding?",
                    "mastery_criteria": ["a correct answer with a reason"],
                    "promotion_requirements": ["two evidence forms across distinct turns"],
                    "remediation_policy": "Increase hint specificity one level at a time.",
                }
                for level in range(1, 7)
            ]
            return json.dumps(
                {
                    "title": "Extracted source concept",
                    "domain": None,
                    "theories": [],
                    "knowledge_points": [
                        {
                            "candidate_key": "source-concept",
                            "canonical_name": "source concept",
                            "plain_definition": "The central idea stated by the supplied source.",
                            "formal_definition": "A source-grounded atomic teaching objective.",
                            "importance": 0.7,
                            "difficulty": 0.4,
                            "prerequisites": [],
                            "must_cover": ["source meaning"],
                            "common_confusions": [],
                            "applicability": ["the supplied learning material"],
                            "limitations": ["pending human verification"],
                            "source_span_ids": [source_id],
                            "six_level_plan": stages,
                            "confidence": 0.75,
                        }
                    ],
                    "relations": [],
                    "examples": [],
                    "counterexamples": [],
                    "misconceptions": [],
                    "questions": [
                        {
                            "candidate_key": "source-concept-question",
                            "knowledge_point_candidate_id": "source-concept",
                            "cognitive_level": 1,
                            "question": (
                                "How would you describe the central idea in everyday words?"
                            ),
                            "success_criteria": ["states the central source-supported idea"],
                            "source_span_ids": [source_id],
                        }
                    ],
                    "unresolved_ambiguities": [],
                }
            )
        return "{}"


def _message_text(message: ChatMessage) -> str:
    if isinstance(message.content, str):
        return message.content
    if not isinstance(message.content, list):
        return ""
    text_parts: list[str] = []
    for part in message.content:
        value = part.get("text")
        if isinstance(value, str):
            text_parts.append(value)
    return "\n".join(text_parts)


def _contains_rag_topic(messages: list[ChatMessage]) -> bool:
    joined = "\n".join(_message_text(message) for message in messages).casefold()
    return re.search(r"(?<![a-z0-9])rag(?![a-z0-9])", joined) is not None


def _rag_blueprint(source_id: str) -> dict[str, object]:
    def stages(label: str) -> list[dict[str, object]]:
        return [
            {
                "cognitive_level": level,
                "learning_objective": f"Demonstrate {label} at level {level}.",
                "teaching_strategy": f"Use the level {level} teaching policy.",
                "must_cover": ["the source-supported central idea"],
                "diagnostic_question": f"What shows level {level} understanding?",
                "mastery_criteria": ["a correct answer with a reason"],
                "promotion_requirements": ["two evidence forms across distinct turns"],
                "remediation_policy": "Increase hint specificity one level at a time.",
            }
            for level in range(1, 7)
        ]

    return {
        "title": "Retrieval-augmented generation",
        "domain": "artificial intelligence",
        "theories": [],
        "knowledge_points": [
            {
                "candidate_key": "rag-target",
                "canonical_name": "retrieval-augmented generation",
                "plain_definition": (
                    "RAG retrieves relevant evidence before a language model generates "
                    "an answer grounded in that evidence."
                ),
                "formal_definition": (
                    "A retrieval function supplies context to a conditional generator."
                ),
                "importance": 0.95,
                "difficulty": 0.55,
                "prerequisites": [],
                "must_cover": ["retrieval", "grounded generation"],
                "common_confusions": ["treating retrieval as model training"],
                "applicability": ["question answering over external knowledge"],
                "limitations": ["answer quality depends on retrieved evidence"],
                "source_span_ids": [source_id],
                "six_level_plan": stages("retrieval-augmented generation"),
                "confidence": 0.9,
            },
            {
                "candidate_key": "grounding-evidence",
                "canonical_name": "grounding evidence",
                "plain_definition": "Evidence used to support a generated answer.",
                "formal_definition": "Retrieved context conditioned on a user query.",
                "importance": 0.7,
                "difficulty": 0.35,
                "prerequisites": [],
                "must_cover": ["evidence relevance"],
                "common_confusions": ["assuming every retrieved passage is correct"],
                "applicability": ["source-backed answers"],
                "limitations": ["retrieved sources can be incomplete"],
                "source_span_ids": [source_id],
                "six_level_plan": stages("grounding evidence"),
                "confidence": 0.85,
            },
        ],
        "relations": [],
        "examples": [],
        "counterexamples": [],
        "misconceptions": [],
        "questions": [],
        "unresolved_ambiguities": [],
    }


def _learning_insights_grade(messages: list[ChatMessage]) -> dict[str, object] | None:
    joined = "\n".join(_message_text(message) for message in messages).casefold()
    misconception = "Bayesian updating ignores the likelihood evidence."
    if "e2e_wrong_bayes_answer" in joined:
        return {
            "correctness": 0.2,
            "reasoning": 0.25,
            "independence": 0.8,
            "transfer": 0.1,
            "misconceptions": [misconception],
            "new_misconceptions": [misconception],
            "confidence": 0.96,
            "question_understanding": 0.7,
            "reasoning_error_type": "ignores_likelihood",
            "missing_conditions": ["likelihood evidence"],
            "resolved_misconceptions": [],
            "explanation": "The answer explicitly ignores likelihood evidence.",
        }
    if "e2e_correct_bayes_answer" in joined:
        return {
            "correctness": 0.95,
            "reasoning": 0.9,
            "independence": 0.9,
            "transfer": 0.85,
            "misconceptions": [],
            "new_misconceptions": [],
            "confidence": 0.97,
            "question_understanding": 0.95,
            "reasoning_error_type": None,
            "missing_conditions": [],
            "resolved_misconceptions": [misconception],
            "explanation": f"The correction explicitly resolves: {misconception}",
        }
    return None


def _learning_insights_blueprint(source_id: str) -> dict[str, object]:
    def stages(candidate_key: str, label: str) -> list[dict[str, object]]:
        return [
            {
                "cognitive_level": level,
                "learning_objective": f"Demonstrate {label} at level {level}.",
                "teaching_strategy": f"Use the level {level} fixture strategy.",
                "required_prerequisites": (
                    ["conditional-probability-foundation"]
                    if candidate_key == "bayesian-updating-target"
                    else []
                ),
                "must_cover": ["the source-supported central idea"],
                "diagnostic_question": f"What demonstrates level {level} understanding?",
                "mastery_criteria": ["a correct independent answer with a reason"],
                "promotion_requirements": ["two evidence forms across distinct turns"],
                "remediation_policy": "Increase hint specificity one level at a time.",
            }
            for level in range(1, 7)
        ]

    return {
        "title": "Learning insights full-stack fixture",
        "domain": "probability",
        "theories": [],
        "knowledge_points": [
            {
                "candidate_key": "conditional-probability-foundation",
                "canonical_name": "conditional probability foundation",
                "plain_definition": (
                    "Conditional probability measures probability under a condition."
                ),
                "formal_definition": "P(A|B)=P(A∩B)/P(B) when P(B)>0.",
                "importance": 0.9,
                "difficulty": 0.35,
                "prerequisites": [],
                "must_cover": ["conditioning event", "joint probability"],
                "common_confusions": ["confusing P(A|B) with P(B|A)"],
                "applicability": ["Bayesian updating"],
                "limitations": ["requires a non-zero conditioning probability"],
                "source_span_ids": [source_id],
                "six_level_plan": stages(
                    "conditional-probability-foundation",
                    "conditional probability",
                ),
                "confidence": 0.95,
            },
            {
                "candidate_key": "bayesian-updating-target",
                "canonical_name": "bayesian updating target",
                "plain_definition": "Bayesian updating combines a prior with likelihood evidence.",
                "formal_definition": "P(H|E) is proportional to P(E|H)P(H).",
                "importance": 0.95,
                "difficulty": 0.65,
                "prerequisites": ["conditional-probability-foundation"],
                "must_cover": ["prior", "likelihood", "posterior"],
                "common_confusions": ["ignoring likelihood evidence"],
                "applicability": ["belief revision"],
                "limitations": ["depends on model assumptions"],
                "source_span_ids": [source_id],
                "six_level_plan": stages("bayesian-updating-target", "Bayesian updating"),
                "confidence": 0.95,
            },
        ],
        "relations": [],
        "examples": [],
        "counterexamples": [],
        "misconceptions": [],
        "questions": [],
        "unresolved_ambiguities": [],
    }
