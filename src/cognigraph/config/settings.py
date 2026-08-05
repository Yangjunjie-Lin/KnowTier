from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="COGNIGRAPH_",
        env_nested_delimiter="__",
        extra="ignore",
    )

    environment: str = "development"
    workspace_scope_required: bool = False
    workspace_provisioning_token: SecretStr | None = Field(default=None, repr=False)
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
    graph_model_enabled: bool = True
    vision_model: str = "openai/gpt-4.1-mini"
    # Visual ingestion is optional in the default lightweight installation.
    # ``ocr_enabled`` controls PaddleOCR, while ``vision_enabled`` controls
    # the final multimodal fallback.
    ocr_enabled: bool = False
    vision_enabled: bool = True
    vision_fallback_enabled: bool = True
    ocr_low_confidence_threshold: float = 0.6
    ocr_min_text_quality: float = 0.2
    vision_max_image_bytes: int = 12 * 1024 * 1024
    vision_max_output_blocks: int = 500
    ocr_pdf_dpi: int = 200
    embedding_model: str = "openai/text-embedding-3-small"
    fallback_models: tuple[str, ...] = ()
    llm_timeout_seconds: float = 30.0
    llm_max_retries: int = 2
    llm_max_concurrency: int = 4
    api_key: SecretStr | None = Field(default=None, repr=False)

    # Model tool calls are optional and always bounded.  When disabled (or
    # when a provider does not advertise support), callers receive the normal
    # prefetched Context Bundle path.
    tool_calling_enabled: bool = True
    max_tool_steps: int = 4
    max_tool_result_bytes: int = 30_000
    tool_timeout_seconds: float = 10.0

    # Canonical names mirror the public deployment contract.  The older
    # names remain validation aliases so existing .env files and integrations
    # continue to work during the migration.
    max_context_tokens: int = Field(  # type: ignore[pydantic-alias]
        default=4_000,
        validation_alias=AliasChoices(
            "max_context_tokens",
            "context_token_budget",
            "COGNIGRAPH_MAX_CONTEXT_TOKENS",
            "COGNIGRAPH_CONTEXT_TOKEN_BUDGET",
        ),
    )
    max_recent_turns: int = Field(  # type: ignore[pydantic-alias]
        default=6,
        validation_alias=AliasChoices(
            "max_recent_turns",
            "recent_turn_limit",
            "COGNIGRAPH_MAX_RECENT_TURNS",
            "COGNIGRAPH_RECENT_TURN_LIMIT",
        ),
    )
    max_graph_depth: int = Field(  # type: ignore[pydantic-alias]
        default=3,
        validation_alias=AliasChoices(
            "max_graph_depth",
            "graph_max_depth",
            "COGNIGRAPH_MAX_GRAPH_DEPTH",
            "COGNIGRAPH_GRAPH_MAX_DEPTH",
        ),
    )
    max_graph_nodes: int = Field(  # type: ignore[pydantic-alias]
        default=100,
        validation_alias=AliasChoices(
            "max_graph_nodes",
            "graph_max_nodes",
            "COGNIGRAPH_MAX_GRAPH_NODES",
            "COGNIGRAPH_GRAPH_MAX_NODES",
        ),
    )
    outbox_worker_enabled: bool = True
    outbox_poll_interval_seconds: float = 1.0
    outbox_batch_size: int = 20

    @field_validator(
        "max_upload_bytes",
        "max_context_tokens",
        "max_recent_turns",
        "max_graph_nodes",
        "outbox_batch_size",
        "max_tool_steps",
        "max_tool_result_bytes",
        "vision_max_image_bytes",
        "vision_max_output_blocks",
    )
    @classmethod
    def positive_limits(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("limit must be positive")
        return value

    @field_validator("outbox_poll_interval_seconds", "tool_timeout_seconds")
    @classmethod
    def positive_interval(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("interval must be positive")
        return value

    @field_validator("max_tool_result_bytes")
    @classmethod
    def tool_result_envelope_fits(cls, value: int) -> int:
        # The bounded envelope itself contains workspace, revision, tool name,
        # count, and truncation metadata before any result data is included.
        if value < 256:
            raise ValueError("max_tool_result_bytes must be at least 256 bytes")
        return value

    @field_validator("max_graph_depth")
    @classmethod
    def bounded_depth(cls, value: int) -> int:
        if not 1 <= value <= 5:
            raise ValueError("max_graph_depth must be between 1 and 5")
        return value

    # Attribute-level compatibility for callers that still use the pre-1.0
    # names.  These are properties rather than duplicate settings, so there
    # is one source of truth for validation and environment loading.
    @property
    def context_token_budget(self) -> int:
        return self.max_context_tokens

    @property
    def recent_turn_limit(self) -> int:
        return self.max_recent_turns

    @property
    def graph_max_depth(self) -> int:
        return self.max_graph_depth

    @property
    def graph_max_nodes(self) -> int:
        return self.max_graph_nodes

    @field_validator("ocr_low_confidence_threshold", "ocr_min_text_quality")
    @classmethod
    def bounded_quality(cls, value: float) -> float:
        if not 0.0 <= value <= 1.0:
            raise ValueError("quality threshold must be between 0 and 1")
        return value

    @field_validator("ocr_pdf_dpi")
    @classmethod
    def bounded_pdf_dpi(cls, value: int) -> int:
        if not 72 <= value <= 600:
            raise ValueError("ocr_pdf_dpi must be between 72 and 600")
        return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
