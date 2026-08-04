from __future__ import annotations

import os

os.environ.setdefault("COGNIGRAPH_USE_MOCK_LLM", "true")
os.environ.setdefault("COGNIGRAPH_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
