from __future__ import annotations

import pickle
from collections.abc import Awaitable, Callable
from itertools import pairwise
from typing import Protocol, TypedDict, cast
from uuid import uuid4


class WorkflowState(TypedDict):
    context: object


WorkflowNode = Callable[[WorkflowState], Awaitable[WorkflowState]]
_CHECKPOINTER: object | None = None


class CompiledWorkflow(Protocol):
    async def ainvoke(
        self,
        state: WorkflowState,
        config: dict[str, object] | None = None,
    ) -> WorkflowState: ...


class TutoringWorkflow:
    """Checkpointed LangGraph orchestration with an import-only fallback."""

    node_order = (
        "understand_and_retrieve",
        "evaluate_response",
        "choose_teaching_action",
        "compile_context",
        "generate_teaching_turn",
        "persist_turn",
    )

    def __init__(self, nodes: dict[str, WorkflowNode]) -> None:
        missing = set(self.node_order).difference(nodes)
        if missing:
            raise ValueError(f"workflow is missing nodes: {sorted(missing)}")
        self.nodes = nodes
        self._compiled = self._compile_langgraph()

    def _compile_langgraph(self) -> CompiledWorkflow | None:
        global _CHECKPOINTER

        try:
            from langchain_core.runnables import RunnableLambda
            from langgraph.checkpoint.memory import InMemorySaver
            from langgraph.checkpoint.serde.base import SerializerCompat
            from langgraph.graph import END, START, StateGraph
        except ImportError:
            return None

        graph = StateGraph(WorkflowState)
        for name in self.node_order:
            graph.add_node(name, RunnableLambda(self.nodes[name]))
        graph.add_edge(START, self.node_order[0])
        for source, target in pairwise(self.node_order):
            graph.add_edge(source, target)
        graph.add_edge(self.node_order[-1], END)
        # The saver is strictly process-local. Pickle is needed because workflow state
        # intentionally carries detached SQLAlchemy records and typed domain objects;
        # no checkpoint bytes cross a trust boundary or are accepted from a caller.
        if _CHECKPOINTER is None:
            _CHECKPOINTER = InMemorySaver(serde=SerializerCompat(pickle))
        checkpointer = cast(InMemorySaver, _CHECKPOINTER)
        return cast(CompiledWorkflow, graph.compile(checkpointer=checkpointer))

    async def run(
        self,
        initial: WorkflowState,
        *,
        checkpoint_id: str | None = None,
    ) -> WorkflowState:
        if self._compiled is not None:
            thread_id = checkpoint_id or str(uuid4())
            config: dict[str, object] = {"configurable": {"thread_id": thread_id}}
            return await self._compiled.ainvoke(initial, config=config)
        state = initial
        for name in self.node_order:
            state = await self.nodes[name](state)
        return state
