from __future__ import annotations

import json
import logging
from contextvars import ContextVar
from datetime import UTC, datetime

request_id_context: ContextVar[str | None] = ContextVar("request_id", default=None)


class JsonFormatter(logging.Formatter):
    _reserved = frozenset(logging.makeLogRecord({}).__dict__)

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", None) or request_id_context.get(),
        }
        for key in (
            "workspace_id",
            "learner_id",
            "session_id",
            "turn_id",
            "model_run_id",
            "graph_revision_id",
            "error_type",
        ):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = str(value)
        if record.exc_info is not None:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    # Desktop installs a rotating App Data file handler before constructing the
    # core FastAPI app.  Keep file destinations intact while refreshing console
    # logging so request failures remain available after Rust drains stderr.
    file_handlers = [
        existing for existing in root.handlers if isinstance(existing, logging.FileHandler)
    ]
    root.handlers = [handler, *file_handlers]
    root.setLevel(level.upper())
