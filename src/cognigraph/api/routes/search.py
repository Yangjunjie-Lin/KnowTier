from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from cognigraph.api.dependencies import (
    RuntimeDependency,
    WorkspaceScopeDependency,
    enforce_workspace_scope,
)
from cognigraph.persistence.postgres.models import (
    Document,
    DocumentChunk,
    GraphNodeRecord,
    LearnerKnowledgeState,
)

router = APIRouter(tags=["search"])


class SearchResultItem(BaseModel):
    kind: Literal["knowledge", "material", "material_content", "learner_state"]
    id: UUID
    title: str
    description: str
    path: str
    score: float = Field(ge=0)
    metadata: dict[str, str | int | float | bool | None] = Field(default_factory=dict)


class SearchResponse(BaseModel):
    query: str
    items: list[SearchResultItem]
    truncated: bool


@router.get("/search", response_model=SearchResponse)
async def global_search(
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
    workspace_id: UUID,
    q: str = Query(min_length=2, max_length=200),
    learner_id: UUID | None = None,
    limit: int = Query(default=30, ge=1, le=50),
) -> SearchResponse:
    enforce_workspace_scope(workspace_scope, workspace_id)
    query = " ".join(q.split()).strip()
    fetch_limit = min(limit, 20)
    async with runtime.database.session() as session:
        nodes = list(
            (
                await session.scalars(
                    select(GraphNodeRecord)
                    .where(
                        GraphNodeRecord.workspace_id == workspace_id,
                        GraphNodeRecord.is_active.is_(True),
                        GraphNodeRecord.display_name.icontains(query, autoescape=True),
                    )
                    .order_by(GraphNodeRecord.display_name)
                    .limit(fetch_limit)
                )
            ).all()
        )
        documents = list(
            (
                await session.scalars(
                    select(Document)
                    .where(
                        Document.workspace_id == workspace_id,
                        Document.filename.icontains(query, autoescape=True),
                    )
                    .order_by(Document.filename)
                    .limit(fetch_limit)
                )
            ).all()
        )
        chunks = list(
            (
                await session.scalars(
                    select(DocumentChunk)
                    .where(
                        DocumentChunk.workspace_id == workspace_id,
                        DocumentChunk.normalized_text.icontains(query, autoescape=True),
                    )
                    .order_by(DocumentChunk.document_id, DocumentChunk.ordinal)
                    .limit(fetch_limit)
                )
            ).all()
        )
        learner_rows: list[tuple[LearnerKnowledgeState, GraphNodeRecord]] = []
        if learner_id is not None:
            learner_rows = list(
                (
                    (
                        await session.execute(
                            select(LearnerKnowledgeState, GraphNodeRecord)
                            .join(
                                GraphNodeRecord,
                                GraphNodeRecord.id == LearnerKnowledgeState.knowledge_point_id,
                            )
                            .where(
                                LearnerKnowledgeState.workspace_id == workspace_id,
                                LearnerKnowledgeState.learner_id == learner_id,
                                GraphNodeRecord.workspace_id == workspace_id,
                                GraphNodeRecord.is_active.is_(True),
                                GraphNodeRecord.display_name.icontains(query, autoescape=True),
                            )
                            .order_by(GraphNodeRecord.display_name)
                            .limit(fetch_limit)
                        )
                    ).tuples()
                ).all()
            )

    document_names = {item.id: item.filename for item in documents}
    missing_document_ids = {item.document_id for item in chunks} - set(document_names)
    if missing_document_ids:
        async with runtime.database.session() as session:
            names = list(
                (
                    await session.execute(
                        select(Document.id, Document.filename).where(
                            Document.workspace_id == workspace_id,
                            Document.id.in_(missing_document_ids),
                        )
                    )
                ).all()
            )
        document_names.update({document_id: filename for document_id, filename in names})

    items = [
        SearchResultItem(
            kind="knowledge",
            id=node.id,
            title=node.display_name,
            description=f"知识图谱 · {_friendly_entity_type(node.entity_type)}",
            path=f"/graph/domain?node={node.id}",
            score=_score(node.display_name, query, base=3.0),
            metadata={
                "entity_type": node.entity_type,
                "epistemic_status": node.epistemic_status,
                "source_confidence": node.source_confidence,
            },
        )
        for node in nodes
    ]
    items.extend(
        SearchResultItem(
            kind="material",
            id=document.id,
            title=document.filename,
            description=f"资料 · {_friendly_document_status(document.status)}",
            path=f"/materials/{document.id}",
            score=_score(document.filename, query, base=2.5),
            metadata={
                "mime_type": document.mime_type,
                "status": document.status,
                "page_count": document.page_count,
            },
        )
        for document in documents
    )
    seen_content_documents: set[UUID] = set()
    for chunk in chunks:
        if chunk.document_id in seen_content_documents:
            continue
        seen_content_documents.add(chunk.document_id)
        items.append(
            SearchResultItem(
                kind="material_content",
                id=chunk.document_id,
                title=document_names.get(chunk.document_id, "资料内容"),
                description=_snippet(chunk.text, query),
                path=f"/materials/{chunk.document_id}",
                score=1.5,
                metadata={
                    "page_start": chunk.page_start,
                    "page_end": chunk.page_end,
                },
            )
        )
    items.extend(
        SearchResultItem(
            kind="learner_state",
            id=node.id,
            title=node.display_name,
            description=f"个人模型 · 掌握度 {state.mastery_score:.0%} · L{state.current_level}",
            path="/model",
            score=_score(node.display_name, query, base=3.5),
            metadata={
                "mastery_score": state.mastery_score,
                "confidence": state.confidence,
                "current_level": state.current_level,
            },
        )
        for state, node in learner_rows
    )
    items.sort(key=lambda item: (-item.score, item.title.casefold(), item.kind))
    return SearchResponse(
        query=query,
        items=items[:limit],
        truncated=len(items) > limit,
    )


def _score(title: str, query: str, *, base: float) -> float:
    normalized_title = title.casefold()
    normalized_query = query.casefold()
    if normalized_title == normalized_query:
        return base + 2
    if normalized_title.startswith(normalized_query):
        return base + 1
    return base


def _snippet(text: str, query: str, *, width: int = 180) -> str:
    normalized = text.casefold()
    index = normalized.find(query.casefold())
    if index < 0:
        index = 0
    start = max(index - width // 3, 0)
    end = min(start + width, len(text))
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return prefix + " ".join(text[start:end].split()) + suffix


def _friendly_entity_type(value: str) -> str:
    return {
        "KnowledgePoint": "知识点",
        "Domain": "领域",
        "Theory": "理论",
        "Concept": "概念",
    }.get(value, "知识实体")


def _friendly_document_status(value: str) -> str:
    return {
        "UPLOADED": "等待摄取",
        "PARSING": "正在摄取",
        "INGESTED": "已摄取",
        "FAILED": "摄取失败",
    }.get(value, "状态未知")
