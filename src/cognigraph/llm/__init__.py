"""Model gateway and structured-output contracts."""

from cognigraph.llm.fake_provider import FakeProvider
from cognigraph.llm.gateway import ModelGateway, ToolCallRejected
from cognigraph.llm.schemas import (
    GraderOutput,
    ModelRole,
    ProviderResponse,
    TeacherOutput,
    ToolCall,
    ToolDefinition,
    ToolResult,
)

__all__ = [
    "FakeProvider",
    "GraderOutput",
    "ModelGateway",
    "ModelRole",
    "ProviderResponse",
    "TeacherOutput",
    "ToolCall",
    "ToolCallRejected",
    "ToolDefinition",
    "ToolResult",
]
