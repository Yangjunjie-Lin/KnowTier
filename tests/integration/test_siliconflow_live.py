from __future__ import annotations

import json
import os

import pytest

from cognigraph.llm.configuration import SILICONFLOW_BASE_URL
from cognigraph.llm.openai_compatible import OpenAICompatibleProvider
from cognigraph.llm.schemas import ChatMessage

EMBEDDING_MODEL_MARKERS = ("embed", "bge", "gte")
NON_CHAT_MODEL_MARKERS = (*EMBEDDING_MODEL_MARKERS, "rerank", "image", "speech", "audio")


def _has_capability_marker(model_id: str, markers: tuple[str, ...]) -> bool:
    folded = model_id.casefold()
    return any(marker in folded for marker in markers)


def _select_models(
    model_ids: list[str], *, preferred_chat_model: str | None = None
) -> tuple[str, str]:
    embedding = next(
        (
            model_id
            for model_id in model_ids
            if _has_capability_marker(model_id, EMBEDDING_MODEL_MARKERS)
        ),
        None,
    )
    if preferred_chat_model is not None:
        if preferred_chat_model not in model_ids:
            raise AssertionError(
                "requested chat model was not returned by SiliconFlow /models: "
                f"{preferred_chat_model}"
            )
        chat = preferred_chat_model
    else:
        chat = next(
            (
                model_id
                for model_id in model_ids
                if not _has_capability_marker(model_id, NON_CHAT_MODEL_MARKERS)
            ),
            None,
        )
    if chat is None or embedding is None:
        raise AssertionError("dynamic model discovery found no chat/embedding capability pair")
    return chat, embedding


def test_select_models_honors_discovered_preferred_chat_model() -> None:
    models = ["provider/embed-v1", "provider/chat-default", "provider/chat-requested"]

    assert _select_models(models, preferred_chat_model="provider/chat-requested") == (
        "provider/chat-requested",
        "provider/embed-v1",
    )


def test_select_models_rejects_unavailable_preferred_chat_model() -> None:
    with pytest.raises(
        AssertionError,
        match="requested chat model was not returned by SiliconFlow /models",
    ):
        _select_models(
            ["provider/embed-v1", "provider/chat-default"],
            preferred_chat_model="provider/chat-requested",
        )


def test_select_models_excludes_every_embedding_candidate_from_chat() -> None:
    models = [
        "BAAI/bge-large-zh-v1.5",
        "BAAI/bge-m3",
        "Qwen/Qwen2.5-7B-Instruct",
    ]

    assert _select_models(models) == (
        "Qwen/Qwen2.5-7B-Instruct",
        "BAAI/bge-large-zh-v1.5",
    )


@pytest.mark.skipif(
    os.getenv("COGNIGRAPH_RUN_SILICONFLOW_LIVE") != "1",
    reason="set COGNIGRAPH_RUN_SILICONFLOW_LIVE=1 for the bounded live provider smoke",
)
@pytest.mark.live_model
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
        request_embedding_dimensions=False,
    )
    try:
        model_ids = await provider.list_models()
        preferred_chat_model = os.getenv("SILICONFLOW_CHAT_MODEL") or None
        chat_model, embedding_model = _select_models(
            model_ids, preferred_chat_model=preferred_chat_model
        )
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
