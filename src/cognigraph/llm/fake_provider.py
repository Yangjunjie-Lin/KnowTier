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
    ) -> None:
        self._responses: deque[str | BaseModel | ProviderResponse | Exception] = deque(
            responses or []
        )
        self.delay_seconds = delay_seconds
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

    @staticmethod
    def _default_payload(
        schema: dict[str, Any],
        messages: list[ChatMessage],
    ) -> str:
        properties = schema.get("properties", {})
        if "correctness" in properties:
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
