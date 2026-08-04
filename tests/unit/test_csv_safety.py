from cognigraph.api.routes.learners import _csv_safe_value


def test_csv_cells_escape_formula_prefixes_after_whitespace() -> None:
    assert _csv_safe_value("=1+1") == "'=1+1"
    assert _csv_safe_value("  @SUM(A1:A2)") == "'  @SUM(A1:A2)"
    assert _csv_safe_value("ordinary text") == "ordinary text"
    assert _csv_safe_value(3) == 3
