from __future__ import annotations

import json
import os

import pytest

from cognigraph.llm.configuration import SILICONFLOW_BASE_URL
from cognigraph.llm.openai_compatible import OpenAICompatibleProvider
from cognigraph.llm.schemas import ChatMessage

pytestmark = pytest.mark.live_model


def _select_models(model_ids: list[str]) -> tuple[str, str]:
    embedding = next(
        (
            model_id
            for model_id in model_ids
            if any(token in model_id.casefold() for token in ("embed", "bge", "gte"))
        ),
        None,
    )
    chat = next(
        (
            model_id
            for model_id in model_ids
            if model_id != embedding
            and not any(
                token in model_id.casefold()
                for token in ("embed", "rerank", "image", "speech", "audio")
            )
        ),
        None,
    )
    if chat is None or embedding is None:
        raise AssertionError("dynamic model discovery found no chat/embedding capability pair")
    return chat, embedding


async def test_live_siliconflow_discovery_structured_chat_and_embedding() -> None:
    assert os.getenv("COGNIGRAPH_RUN_SILICONFLOW_LIVE") == "1", (
        "live SiliconFlow tests require an explicit workflow_dispatch or local opt-in"
    )
    api_key = os.getenv("SILICONFLOW_API_KEY")
    assert api_key, "SILICONFLOW_API_KEY secret is required for the explicit live test"

    # Strict external budget: exactly one discovery, one chat and one embedding request.
    provider = OpenAICompatibleProvider(
        provider_name="siliconflow-live",
        base_url=SILICONFLOW_BASE_URL,
        api_key=api_key,
        timeout_seconds=30,
        max_retries=0,
        temperature=0,
        max_tokens=96,
    )
    try:
        model_ids = await provider.list_models()
        chat_model, embedding_model = _select_models(model_ids)
        response = await provider.complete(
            model=chat_model,
            messages=[
                ChatMessage(
                    role="user",
                    content="Return JSON with ok=true. Do not include any other content.",
                )
            ],
            response_schema={
                "type": "object",
                "properties": {"ok": {"type": "boolean"}},
                "required": ["ok"],
                "additionalProperties": False,
            },
        )
        assert response.content is not None
        assert json.loads(response.content) == {"ok": True}
        vectors = await provider.embed(model=embedding_model, texts=["budgeted probe"])
        assert len(vectors) == 1
        # Dimension varies by discovered embedding model; only require a usable vector.
        assert len(vectors[0]) >= 8
        assert all(isinstance(value, float) for value in vectors[0][:8])
    finally:
        await provider.aclose()
