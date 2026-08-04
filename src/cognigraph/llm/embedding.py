from __future__ import annotations

import asyncio
import hashlib
import math
from typing import Protocol

from pydantic import SecretStr


class EmbeddingProvider(Protocol):
    async def embed(self, texts: list[str]) -> list[list[float]]: ...


class DeterministicEmbeddingProvider:
    """Stable local embeddings for tests; not intended for semantic production retrieval."""

    def __init__(self, dimensions: int = 32) -> None:
        if dimensions <= 0:
            raise ValueError("dimensions must be positive")
        self.dimensions = dimensions

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(text) for text in texts]

    def _embed_one(self, text: str) -> list[float]:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        values = [
            ((digest[index % len(digest)] / 255.0) * 2) - 1 for index in range(self.dimensions)
        ]
        norm = math.sqrt(sum(value * value for value in values)) or 1.0
        return [value / norm for value in values]


class LiteLLMEmbeddingProvider:
    def __init__(
        self,
        model: str,
        *,
        fallbacks: tuple[str, ...] = (),
        timeout_seconds: float = 30.0,
        max_retries: int = 2,
        max_concurrency: int = 4,
        expected_dimensions: int = 1536,
        api_key: SecretStr | str | None = None,
    ) -> None:
        self.model = model
        self.fallbacks = tuple(item for item in fallbacks if item != model)
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.expected_dimensions = expected_dimensions
        self._api_key = api_key.get_secret_value() if isinstance(api_key, SecretStr) else api_key
        self._semaphore = asyncio.Semaphore(max_concurrency)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        try:
            from litellm import aembedding
        except ImportError as exc:
            raise RuntimeError("LiteLLM is required for production embeddings") from exc
        errors: list[Exception] = []
        for model in (self.model, *self.fallbacks):
            for attempt in range(self.max_retries + 1):
                options: dict[str, object] = {}
                if self._api_key:
                    options["api_key"] = self._api_key
                try:
                    async with self._semaphore:
                        response = await asyncio.wait_for(
                            aembedding(model=model, input=texts, **options),
                            timeout=self.timeout_seconds,
                        )
                    vectors = [
                        list(
                            map(
                                float,
                                item["embedding"] if isinstance(item, dict) else item.embedding,
                            )
                        )
                        for item in response.data
                    ]
                    if len(vectors) != len(texts):
                        raise RuntimeError("embedding provider returned the wrong row count")
                    if any(len(vector) != self.expected_dimensions for vector in vectors):
                        raise RuntimeError(
                            "embedding dimensions do not match the configured database vector"
                        )
                    return vectors
                except (TimeoutError, RuntimeError, ValueError, TypeError) as exc:
                    errors.append(exc)
                    if attempt < self.max_retries:
                        await asyncio.sleep(min(0.1 * (2**attempt), 1.0))
        summary = "; ".join(type(item).__name__ for item in errors[-3:])
        raise RuntimeError(f"embedding request failed after fallbacks: {summary}")
