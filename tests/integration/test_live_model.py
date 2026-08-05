from __future__ import annotations

import os

import pytest
from pydantic import SecretStr

from cognigraph.config import Settings
from cognigraph.llm.gateway import LiteLLMProvider, ModelGateway
from cognigraph.llm.schemas import ChatMessage, ModelCallContext, ModelRole, TeacherOutput

pytestmark = [pytest.mark.integration, pytest.mark.live_model]


def _live_model_config() -> tuple[str, str]:
    if os.getenv("COGNIGRAPH_RUN_LIVE_MODEL") != "1":
        pytest.skip("set COGNIGRAPH_RUN_LIVE_MODEL=1 to run the live model smoke test")
    api_key = os.getenv("COGNIGRAPH_LIVE_MODEL_API_KEY", "").strip()
    if not api_key:
        pytest.skip(
            "set COGNIGRAPH_LIVE_MODEL_API_KEY (a repository secret in CI) to run live models"
        )
    model = os.getenv("COGNIGRAPH_LIVE_MODEL", "openai/gpt-4.1-mini").strip()
    if not model:
        pytest.fail("COGNIGRAPH_LIVE_MODEL must not be empty")
    return model, api_key


@pytest.mark.asyncio
async def test_litellm_live_model_returns_teacher_schema() -> None:
    model, api_key = _live_model_config()
    settings = Settings(
        use_mock_llm=False,
        api_key=SecretStr(api_key),
        teacher_model=model,
        llm_timeout_seconds=float(os.getenv("COGNIGRAPH_LIVE_MODEL_TIMEOUT_SECONDS", "45")),
        llm_max_retries=0,
        tool_calling_enabled=False,
    )
    gateway = ModelGateway(settings, LiteLLMProvider(settings.api_key))
    output, result = await gateway.generate_structured(
        role=ModelRole.TEACHER,
        messages=[
            ChatMessage(
                role="system",
                content=(
                    "Return a concise tutoring response as JSON matching the requested schema. "
                    "Use no external tools and make no unsupported factual claims."
                ),
            ),
            ChatMessage(
                role="user",
                content=(
                    "Explain in one short lesson why a claim needs evidence, then ask one "
                    "check question."
                ),
            ),
        ],
        response_model=TeacherOutput,
        context=ModelCallContext(prompt_name="live_model_smoke", prompt_version="ci"),
    )

    assert output.core_explanation.strip()
    assert output.assessment.question.strip()
    assert result.provider == "litellm"
    assert result.model == model
