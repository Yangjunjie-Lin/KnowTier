from cognigraph.domain.enums import AssessmentType
from cognigraph.llm.schemas import TeacherAssessment, TeacherOutput


def test_render_keeps_the_mastery_check_in_its_structured_field() -> None:
    output = TeacherOutput(
        acknowledgement="Good start.",
        core_explanation="A compact explanation.",
        illustration="One grounded example.",
        key_takeaway="The key takeaway.",
        assessment=TeacherAssessment(
            type=AssessmentType.EXPLAIN_REASON,
            question="Why does this work?",
        ),
    )

    assert "Why does this work?" not in output.render()
    assert output.assessment.question == "Why does this work?"
