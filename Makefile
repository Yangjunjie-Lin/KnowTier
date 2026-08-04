.PHONY: install lock-check format format-check lint typecheck test check run migrate demo

install:
	uv sync --dev

lock-check:
	uv lock --check

format:
	uv run ruff format src tests scripts

format-check:
	uv run ruff format --check src tests scripts

lint:
	uv run ruff check src tests scripts

typecheck:
	uv run mypy src/cognigraph

test:
	uv run pytest

check: lock-check format-check lint typecheck test

run:
	uv run uvicorn cognigraph.main:app --reload

migrate:
	uv run cognigraph db migrate

demo:
	uv run cognigraph demo
