from __future__ import annotations

from types import TracebackType
from typing import Any

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from cognigraph.persistence.postgres.base import Base
from cognigraph.persistence.repositories.documents import DocumentRepository
from cognigraph.persistence.repositories.graph import GraphDeltaRepository
from cognigraph.persistence.repositories.learner_graph import LearnerGraphRepository
from cognigraph.persistence.repositories.learners import LearnerRepository, LearnerStateRepository
from cognigraph.persistence.repositories.operations import (
    AuditRepository,
    ModelConfigRepository,
    ModelRunRepository,
    PromptRepository,
)
from cognigraph.persistence.repositories.sessions import SessionRepository, TurnRepository
from cognigraph.persistence.repositories.workspaces import WorkspaceRepository


class Database:
    """Own the async engine and session factory for the SQL system of record."""

    def __init__(
        self,
        url: str,
        *,
        echo: bool = False,
        pool_pre_ping: bool = True,
    ) -> None:
        self.url = self._async_url(url)
        engine_options: dict[str, object] = {
            "echo": echo,
            "pool_pre_ping": pool_pre_ping,
        }
        if self.url.startswith("sqlite"):
            # SQLite serializes writers.  A short default busy timeout makes
            # concurrent repository tests fail nondeterministically before the
            # repository's bounded unique-conflict retry can run.
            engine_options["connect_args"] = {"timeout": 30}
        self.engine: AsyncEngine = create_async_engine(self.url, **engine_options)
        if self.url.startswith("sqlite"):
            self._enable_sqlite_foreign_keys()
        self.session_factory = async_sessionmaker(
            bind=self.engine,
            class_=AsyncSession,
            autoflush=True,
            expire_on_commit=False,
        )

    def _enable_sqlite_foreign_keys(self) -> None:
        @event.listens_for(self.engine.sync_engine, "connect")
        def set_sqlite_pragma(dbapi_connection: Any, _connection_record: Any) -> None:
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.execute("PRAGMA busy_timeout=30000")
            finally:
                cursor.close()

    @staticmethod
    def _async_url(url: str) -> str:
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+asyncpg://", 1)
        if url.startswith("postgres://"):
            return url.replace("postgres://", "postgresql+asyncpg://", 1)
        if url.startswith("sqlite://") and not url.startswith("sqlite+aiosqlite://"):
            return url.replace("sqlite://", "sqlite+aiosqlite://", 1)
        return url

    def session(self) -> AsyncSession:
        return self.session_factory()

    def unit_of_work(self) -> SqlAlchemyUnitOfWork:
        return SqlAlchemyUnitOfWork(self.session_factory)

    async def ping(self) -> bool:
        try:
            async with self.session_factory() as session:
                await session.execute(text("SELECT 1"))
            return True
        except Exception:
            return False

    async def create_schema(self) -> None:
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def drop_schema(self) -> None:
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)

    async def dispose(self) -> None:
        await self.engine.dispose()


class SqlAlchemyUnitOfWork:
    """One transaction spanning repositories that participate in a use case."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory
        self.session: AsyncSession | None = None
        self.workspaces: WorkspaceRepository
        self.learners: LearnerRepository
        self.learner_states: LearnerStateRepository
        self.learner_graph: LearnerGraphRepository
        self.sessions: SessionRepository
        self.turns: TurnRepository
        self.documents: DocumentRepository
        self.graph: GraphDeltaRepository
        self.model_configs: ModelConfigRepository
        self.model_runs: ModelRunRepository
        self.prompts: PromptRepository
        self.audit: AuditRepository
        self._completed = False

    async def __aenter__(self) -> SqlAlchemyUnitOfWork:
        if self.session is not None:
            raise RuntimeError("unit of work cannot be re-entered")
        self.session = self._session_factory()
        await self.session.begin()
        self.workspaces = WorkspaceRepository(self.session)
        self.learners = LearnerRepository(self.session)
        self.learner_states = LearnerStateRepository(self.session)
        self.learner_graph = LearnerGraphRepository(self.session)
        self.sessions = SessionRepository(self.session)
        self.turns = TurnRepository(self.session)
        self.documents = DocumentRepository(self.session)
        self.graph = GraphDeltaRepository(self.session)
        self.model_configs = ModelConfigRepository(self.session)
        self.model_runs = ModelRunRepository(self.session)
        self.prompts = PromptRepository(self.session)
        self.audit = AuditRepository(self.session)
        return self

    async def commit(self) -> None:
        session = self._require_session()
        await session.commit()
        self._completed = True

    async def rollback(self) -> None:
        session = self._require_session()
        await session.rollback()
        self._completed = True

    async def flush(self) -> None:
        await self._require_session().flush()

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        session = self._require_session()
        try:
            if exc_type is not None:
                await session.rollback()
            elif not self._completed:
                await session.commit()
        finally:
            await session.close()
            self.session = None

    def _require_session(self) -> AsyncSession:
        if self.session is None:
            raise RuntimeError("unit of work must be entered before use")
        return self.session
