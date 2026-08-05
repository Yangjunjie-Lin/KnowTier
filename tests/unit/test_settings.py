from __future__ import annotations

import pytest

from cognigraph.config import Settings
from cognigraph.ingestion.ocr_adapter import OCRUnavailableError, PaddleOCRAdapter
from cognigraph.services.runtime import ApplicationRuntime


def test_public_budget_environment_names_are_loaded(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("COGNIGRAPH_MAX_CONTEXT_TOKENS", "8192")
    monkeypatch.setenv("COGNIGRAPH_MAX_RECENT_TURNS", "9")
    monkeypatch.setenv("COGNIGRAPH_MAX_GRAPH_DEPTH", "4")
    monkeypatch.setenv("COGNIGRAPH_MAX_GRAPH_NODES", "250")

    settings = Settings(_env_file=None)

    assert settings.max_context_tokens == 8192
    assert settings.max_recent_turns == 9
    assert settings.max_graph_depth == 4
    assert settings.max_graph_nodes == 250


def test_legacy_budget_names_remain_compatible() -> None:
    settings = Settings(
        context_token_budget=2048,
        recent_turn_limit=5,
        graph_max_depth=2,
        graph_max_nodes=75,
    )

    assert settings.max_context_tokens == settings.context_token_budget == 2048
    assert settings.max_recent_turns == settings.recent_turn_limit == 5
    assert settings.max_graph_depth == settings.graph_max_depth == 2
    assert settings.max_graph_nodes == settings.graph_max_nodes == 75


def test_lightweight_default_does_not_enable_optional_ocr_runtime() -> None:
    assert not Settings(_env_file=None).ocr_enabled


def test_runtime_fails_fast_when_enabled_ocr_runtime_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unavailable() -> None:
        raise OCRUnavailableError("OCR opt-in runtime is unavailable")

    monkeypatch.setattr(PaddleOCRAdapter, "require_runtime", unavailable)

    with pytest.raises(OCRUnavailableError, match="opt-in runtime is unavailable"):
        ApplicationRuntime(Settings(_env_file=None, ocr_enabled=True))
