import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  filterGraphElements,
  GraphListView,
  graphNodeShape,
} from "./GraphCanvas";
import type { CytoscapeGraph, GraphEdgeData, GraphNodeData } from "@/types/api";

const nodes: GraphNodeData[] = [
  { id: "domain", type: "Domain", label: "计算机科学" },
  { id: "knowledge", type: "KnowledgePoint", label: "递归" },
];
const edges: GraphEdgeData[] = [
  {
    id: "edge-1",
    assertion_id: "edge-1",
    source: "domain",
    target: "knowledge",
    relation_type: "CONTAINS",
    natural_language_description: "包含知识点",
  },
];

describe("GraphCanvas helpers", () => {
  it("uses different shapes for the required product node types", () => {
    const types = [
      "Domain",
      "Theory",
      "KnowledgePoint",
      "Definition",
      "Method",
      "Example",
      "Counterexample",
      "Misconception",
      "SourceDocument",
      "Learner",
      "LearnerKnowledgeState",
    ];
    expect(new Set(types.map(graphNodeShape)).size).toBeGreaterThanOrEqual(9);
    expect(graphNodeShape("FutureType")).toBe("ellipse");
  });

  it("filters nodes first and never leaves dangling relationships", () => {
    const graph: CytoscapeGraph = {
      elements: {
        nodes: nodes.map((data) => ({ data })),
        edges: edges.map((data) => ({ data })),
      },
      meta: {},
    };
    const visible = filterGraphElements(graph, "递归", undefined, undefined);
    expect(visible.nodes.map((node) => node.data.id)).toEqual(["knowledge"]);
    expect(visible.edges).toEqual([]);
  });
});

describe("GraphListView", () => {
  it("exposes nodes and directional relationships as keyboard-accessible options", () => {
    const onNodeSelect = vi.fn();
    const onEdgeSelect = vi.fn();
    render(
      <GraphListView
        nodes={nodes}
        edges={edges}
        selectedId="knowledge"
        onNodeSelect={onNodeSelect}
        onEdgeSelect={onEdgeSelect}
      />,
    );

    expect(screen.getByText("包含知识点")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    const nodeList = screen.getByRole("listbox", { name: "图谱节点" });
    expect(within(nodeList).getByRole("option", { name: /递归/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const list = screen.getByLabelText(/知识图谱列表/);
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onNodeSelect).toHaveBeenCalledWith(nodes[1]);

    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onEdgeSelect).toHaveBeenCalledWith(edges[0]);
  });
});
