import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import cytoscape from "cytoscape";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGraphCanvasElements,
  buildGraphLayoutOptions,
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

afterEach(cleanup);

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

  it("does not search internal identifiers in learner presentation", () => {
    const graph: CytoscapeGraph = {
      elements: {
        nodes: nodes.map((data) => ({ data })),
        edges: edges.map((data) => ({ data })),
      },
      meta: {},
    };
    expect(
      filterGraphElements(graph, "knowledge", undefined, undefined, false).nodes,
    ).toEqual([]);
  });

  it("keeps an aggregated learner line when any contained relation matches", () => {
    const graph: CytoscapeGraph = {
      elements: {
        nodes: nodes.map((data) => ({ data })),
        edges: [
          {
            data: {
              ...edges[0]!,
              relation_types: ["HAS_MISCONCEPTION", "REQUIRES_REVIEW"],
            },
          },
        ],
      },
      meta: {},
    };

    expect(
      filterGraphElements(graph, "", undefined, ["REQUIRES_REVIEW"], false).edges,
    ).toHaveLength(1);
  });

  it("enforces one line per learner node pair when raw duplicate edges reach the canvas", () => {
    const graph: CytoscapeGraph = {
      elements: {
        nodes: nodes.map((data) => ({
          data: {
            ...data,
            ontology_entity_type:
              data.id === "domain" ? "learner" : "knowledge_state",
            ontology_role: data.id === "domain" ? "identity" : "knowledge",
          },
        })),
        edges: [
          {
            data: {
              ...edges[0]!,
              relation_type: "LEARNING_GOAL",
            },
          },
          {
            data: {
              ...edges[0]!,
              id: "edge-2",
              assertion_id: "edge-2",
              relation_type: "RECENTLY_PRACTICED",
            },
          },
        ],
      },
      meta: {},
    };

    const visible = filterGraphElements(
      graph,
      "",
      undefined,
      undefined,
      false,
    );
    expect(visible.edges).toHaveLength(1);
    expect(visible.edges[0]?.data.relationship_count).toBe(2);
    expect(visible.edges[0]?.data.relation_types).toEqual([
      "LEARNING_GOAL",
      "RECENTLY_PRACTICED",
    ]);
  });

  it("enforces one visual Cytoscape edge even when duplicate learner data bypasses filtering", () => {
    const learnerNodes = nodes.map((data) => ({
      data: {
        ...data,
        ontology_entity_type:
          data.id === "domain" ? "learner" : "knowledge_state",
        ontology_role: data.id === "domain" ? "identity" : "knowledge",
      },
    }));
    const rawDuplicateEdges = [
      { data: { ...edges[0]!, relation_type: "LEARNING_GOAL" } },
      {
        data: {
          ...edges[0]!,
          id: "edge-2",
          assertion_id: "edge-2",
          relation_type: "RECENTLY_PRACTICED",
        },
      },
      {
        data: {
          ...edges[0]!,
          id: "edge-3",
          assertion_id: "edge-3",
          source: "knowledge",
          target: "domain",
          relation_type: "REQUIRES_REVIEW",
        },
      },
    ];

    const elements = buildGraphCanvasElements(
      { nodes: learnerNodes, edges: rawDuplicateEdges },
      "learner",
      "zh-CN",
    );
    const renderedEdges = elements.slice(learnerNodes.length) as Array<{
      data: GraphEdgeData;
    }>;

    expect(renderedEdges).toHaveLength(1);
    expect(renderedEdges[0]?.data.id).toBe("learner-link:domain:knowledge");
    expect(renderedEdges[0]?.data.relationship_count).toBe(3);
    expect(renderedEdges[0]?.data.relationship_summaries).toHaveLength(3);
  });

  it("keeps concentric learner coordinates finite with multiple nodes on one ring", () => {
    const layout = buildGraphLayoutOptions(3, 2, "learner", "comfortable");
    const cy = cytoscape({
      headless: true,
      styleEnabled: true,
      elements: [
        { data: { id: "learner", ontology_role: "identity" } },
        { data: { id: "knowledge-a", ontology_role: "knowledge" } },
        { data: { id: "knowledge-b", ontology_role: "knowledge" } },
        { data: { id: "edge-a", source: "learner", target: "knowledge-a" } },
        { data: { id: "edge-b", source: "learner", target: "knowledge-b" } },
      ],
      style: [
        {
          selector: "node",
          style: { width: 42, height: 42 },
        },
      ],
      layout,
    });

    const coordinates = cy
      .nodes()
      .toArray()
      .flatMap((node) => [node.position("x"), node.position("y")]);
    expect(coordinates.every(Number.isFinite)).toBe(true);
    expect(Math.max(...coordinates.map(Math.abs))).toBeLessThan(10_000);
    expect(layout).not.toHaveProperty("sweep");
    cy.destroy();
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

  it("uses mastery summaries instead of backend node types for learners", () => {
    render(
      <GraphListView
        nodes={[
          {
            id: "knowledge",
            label: "递归",
            type: "LearnerKnowledgeState",
            mastery_score: 0.72,
            learner_status: "学习中",
          },
        ]}
        edges={[]}
        presentation="learner"
      />,
    );
    expect(screen.getByText("学习中 · 掌握 72%")).toBeInTheDocument();
    expect(screen.queryByText("学习者知识状态")).not.toBeInTheDocument();
  });

  it("localizes domain node and fallback relation labels in English", () => {
    render(
      <GraphListView
        nodes={nodes}
        edges={[{ ...edges[0]!, natural_language_description: undefined }]}
        selectedId={null}
        onNodeSelect={vi.fn()}
        onEdgeSelect={vi.fn()}
        locale="en"
      />,
    );

    expect(screen.getByText("Domain")).toBeInTheDocument();
    expect(screen.getByText("Knowledge point")).toBeInTheDocument();
    expect(screen.getByText("Other knowledge relationship")).toBeInTheDocument();
  });
});
