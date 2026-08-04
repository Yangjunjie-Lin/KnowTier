"""Transactional outbox processing."""

from cognigraph.persistence.outbox.dispatcher import OutboxDispatcher, OutboxRepository

__all__ = ["OutboxDispatcher", "OutboxRepository"]
