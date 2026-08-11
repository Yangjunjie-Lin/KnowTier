from __future__ import annotations

import json
import logging
from pathlib import Path

from cognigraph.desktop.sidecar import install_file_logging
from cognigraph.logging import configure_logging


def test_desktop_file_logging_survives_core_logging_configuration(tmp_path: Path) -> None:
    root = logging.getLogger()
    original_handlers = list(root.handlers)
    original_level = root.level
    try:
        install_file_logging(tmp_path)
        configure_logging("INFO")

        logging.getLogger("cognigraph.desktop.test").error(
            "safe failure summary",
            extra={"error_type": "DiagnosticError"},
        )
        for handler in root.handlers:
            handler.flush()

        records = [
            json.loads(line)
            for line in (tmp_path / "knowtier-desktop.jsonl")
            .read_text(encoding="utf-8")
            .splitlines()
        ]
        assert records[-1]["message"] == "safe failure summary"
        assert records[-1]["error_type"] == "DiagnosticError"
    finally:
        added_handlers = [handler for handler in root.handlers if handler not in original_handlers]
        root.handlers = original_handlers
        root.setLevel(original_level)
        for handler in added_handlers:
            handler.close()
