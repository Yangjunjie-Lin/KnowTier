from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class PromptAsset:
    name: str
    version: str
    content: str
    content_hash: str


class PromptManager:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path(__file__).parent

    def load(self, name: str, version: str | None = None) -> PromptAsset:
        if not name.replace("_", "").isalnum():
            raise ValueError("prompt name contains unsupported characters")
        path = (self.root / f"{name}.md").resolve()
        if self.root.resolve() not in path.parents:
            raise ValueError("prompt path escaped the prompt directory")
        content = path.read_text(encoding="utf-8")
        content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
        return PromptAsset(
            name=name,
            version=version or f"sha256-{content_hash[:12]}",
            content=content,
            content_hash=content_hash,
        )

    def load_all(self) -> list[PromptAsset]:
        return [self.load(path.stem) for path in sorted(self.root.glob("*.md"))]
