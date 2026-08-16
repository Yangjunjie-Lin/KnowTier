from __future__ import annotations

from collections.abc import Mapping
from uuid import UUID

from cognigraph.api.schemas import (
    ChatResponse,
    ConversationAssistantTurnResponse,
    ConversationHistoryItemResponse,
    ConversationHistoryResponse,
    ConversationUserTurnResponse,
)
from cognigraph.persistence.postgres.models import ConversationTurn
from cognigraph.services.runtime import ApplicationRuntime

_MAX_RESTORED_TURNS = 200


class ConversationHistoryService:
    """Build the learner-facing projection of persisted tutoring turns."""

    def __init__(self, runtime: ApplicationRuntime) -> None:
        self.runtime = runtime

    async def get(
        self,
        *,
        workspace_id: UUID,
        learner_id: UUID,
        session_id: UUID,
    ) -> ConversationHistoryResponse:
        async with self.runtime.database.unit_of_work() as unit:
            turns = await unit.turns.for_learner_session(
                workspace_id=workspace_id,
                learner_id=learner_id,
                session_id=session_id,
                limit=_MAX_RESTORED_TURNS + 1,
            )

        turns, truncated = _recent_turn_window(turns, limit=_MAX_RESTORED_TURNS)
        items: list[ConversationHistoryItemResponse] = []
        for turn in turns:
            if turn.role == "user":
                items.append(
                    ConversationUserTurnResponse(
                        id=turn.id,
                        content=turn.content,
                        attachment_ids=_attachment_ids(turn.metadata_json),
                        created_at=turn.created_at,
                    )
                )
                continue
            if turn.role != "assistant":
                continue
            response = _verified_chat_response(
                turn.metadata_json,
                turn_id=turn.id,
                content=turn.content,
            )
            if response is None:
                continue
            items.append(
                ConversationAssistantTurnResponse(
                    id=turn.id,
                    response=response,
                    created_at=turn.created_at,
                )
            )

        return ConversationHistoryResponse(
            workspace_id=workspace_id,
            learner_id=learner_id,
            session_id=session_id,
            turn_limit=_MAX_RESTORED_TURNS,
            truncated=truncated,
            items=items,
        )


def _recent_turn_window(
    turns: list[ConversationTurn],
    *,
    limit: int,
) -> tuple[list[ConversationTurn], bool]:
    truncated = len(turns) > limit
    window = turns[-limit:]
    if truncated and window and window[0].role == "assistant":
        window = window[1:]
    return window, truncated


def _verified_chat_response(
    metadata: Mapping[str, object],
    *,
    turn_id: UUID,
    content: str,
) -> ChatResponse | None:
    stored_response = metadata.get("chat_response")
    if not isinstance(stored_response, Mapping):
        return None
    try:
        response = ChatResponse.model_validate(stored_response)
    except ValueError:
        return None
    if response.turn_id != turn_id or response.response != content:
        return None
    return response


def _attachment_ids(metadata: Mapping[str, object]) -> list[UUID]:
    raw_ids = metadata.get("attachment_ids")
    if not isinstance(raw_ids, list):
        return []
    attachment_ids: list[UUID] = []
    seen: set[UUID] = set()
    for raw_id in raw_ids:
        if isinstance(raw_id, UUID):
            attachment_id = raw_id
        elif isinstance(raw_id, str):
            try:
                attachment_id = UUID(raw_id)
            except ValueError:
                continue
        else:
            continue
        if attachment_id in seen:
            continue
        seen.add(attachment_id)
        attachment_ids.append(attachment_id)
        if len(attachment_ids) == 20:
            break
    return attachment_ids
