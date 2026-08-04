from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="COGNIGRAPH_",
        env_nested_delimiter="__",
        extra="ignore",
    )

    environment: str = "development"
    log_level: str = "INFO"
    database_url: str = "sqlite+aiosqlite:///./data/cognigraph.db"
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: SecretStr = SecretStr("cognigraph-dev-password")
    neo4j_required: bool = False
    storage_path: Path = Path("data/uploads")
    max_upload_bytes: int = 25 * 1024 * 1024
    allowed_mime_types: tuple[str, ...] = (
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/plain",
        "text/markdown",
        "image/png",
        "image/jpeg",
        "image/tiff",
    )

    use_mock_llm: bool = True
    teacher_model: str = "openai/gpt-4.1-mini"
    extractor_model: str = "openai/gpt-4.1-mini"
    grader_model: str = "openai/gpt-4.1-mini"
    graph_model: str = "openai/gpt-4.1-mini"
    vision_model: str = "openai/gpt-4.1-mini"
    embedding_model: str = "openai/text-embedding-3-small"
    fallback_models: tuple[str, ...] = ()
    llm_timeout_seconds: float = 30.0
    llm_max_retries: int = 2
    llm_max_concurrency: int = 4
    api_key: SecretStr | None = Field(default=None, repr=False)

    context_token_budget: int = 4_000
    recent_turn_limit: int = 6
    graph_max_depth: int = 3
    graph_max_nodes: int = 100
    outbox_worker_enabled: bool = True
    outbox_poll_interval_seconds: float = 1.0
    outbox_batch_size: int = 20

    @field_validator(
        "max_upload_bytes",
        "context_token_budget",
        "graph_max_nodes",
        "outbox_batch_size",
    )
    @classmethod
    def positive_limits(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("limit must be positive")
        return value

    @field_validator("outbox_poll_interval_seconds")
    @classmethod
    def positive_interval(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("outbox_poll_interval_seconds must be positive")
        return value

    @field_validator("graph_max_depth")
    @classmethod
    def bounded_depth(cls, value: int) -> int:
        if not 1 <= value <= 5:
            raise ValueError("graph_max_depth must be between 1 and 5")
        return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
