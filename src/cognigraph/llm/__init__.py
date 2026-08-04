"""Model gateway and structured-output contracts."""

from cognigraph.llm.fake_provider import FakeProvider
from cognigraph.llm.gateway import ModelGateway
from cognigraph.llm.schemas import GraderOutput, ModelRole, TeacherOutput

__all__ = ["FakeProvider", "GraderOutput", "ModelGateway", "ModelRole", "TeacherOutput"]
