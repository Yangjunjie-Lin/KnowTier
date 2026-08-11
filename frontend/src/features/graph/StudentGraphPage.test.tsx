import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import type { CytoscapeGraph, GraphNodeData } from "@/types/api";
import { StudentGraphPage } from "./StudentGraphPage";

const learnerId = "11111111-1111-4111-8111-111111111111";
const knowledgeId = "22222222-2222-4222-8222-222222222222";
const evidenceId = "33333333-3333-4333-8333-333333333333";

const { localeState } = vi.hoisted(() => ({
  localeState: { value: "zh-CN" as "zh-CN" | "en" },
}));

const graph: CytoscapeGraph = {
  elements: {
    nodes: [
      { data: { id: learnerId, type: "Learner", label: "测试学习者" } },
      {
        data: {
          id: knowledgeId,
          type: "LearnerKnowledgeState",
          label: "递归",
          mastery_score: 0.72,
          confidence: 0.86,
        },
      },
      {
        data: {
          id: evidenceId,
          type: "LearnerGraphResource",
          label: evidenceId,
        },
      },
    ],
    edges: [
      {
        data: {
          id: "edge-1",
          assertion_id: "edge-1",
          source: learnerId,
          target: knowledgeId,
          relation_type: "HAS_MISCONCEPTION",
          natural_language_description: "把终止条件写反了",
          valid_to: null,
        },
      },
      {
        data: {
          id: "edge-2",
          assertion_id: "edge-2",
          source: learnerId,
          target: evidenceId,
          relation_type: "HAS_MASTERY_EVIDENCE",
          valid_to: null,
        },
      },
      {
        data: {
          id: "edge-3",
          assertion_id: "edge-3",
          source: learnerId,
          target: knowledgeId,
          relation_type: "REQUIRES_REVIEW",
          confidence: 0.75,
          valid_to: null,
        },
      },
    ],
  },
  meta: {},
};

vi.mock("@/stores/AppContext", () => {
  const store = () => ({
    currentLearner: { id: learnerId, display_name: "测试学习者" },
    preferences: {
      graphDensity: "comfortable",
      graphLabelDensity: "balanced",
      uiLocale: localeState.value,
    },
    setUiLocale: vi.fn(),
  });
  return { useAppStore: store, useOptionalAppStore: store };
});

vi.mock("@/services/api", () => ({
  api: {
    getLearnerGraph: vi.fn(),
    getLearnerNodeDetail: vi.fn(),
    getLearnerAssertionDetail: vi.fn(),
    getModelRuntime: vi.fn(),
  },
}));

vi.mock("@/components/shared/RuntimeModelBadge", () => ({
  RuntimeModelBadge: () => <span>关系整理模型</span>,
}));

vi.mock("@/components/graph/GraphCanvas", () => ({
  GraphCanvas: ({
    graph: presented,
    onNodeSelect,
    onEdgeSelect,
  }: {
    graph: CytoscapeGraph;
    onNodeSelect: (node: GraphNodeData) => void;
    onEdgeSelect: (edge: CytoscapeGraph["elements"]["edges"][number]["data"]) => void;
  }) => (
    <div aria-label="学生关系图">
      {presented.elements.nodes.map(({ data }) => (
        <button key={data.id} type="button" onClick={() => onNodeSelect(data)}>
          {typeof data.label === "string" ? data.label : "学习内容"}
        </button>
      ))}
      {presented.elements.edges.map(({ data }) => (
        <button
          key={data.id}
          type="button"
          aria-label={`关系 ${typeof data.display_label === "string" ? data.display_label : "学习关联"}`}
          onClick={() => onEdgeSelect(data)}
        >
          {typeof data.display_label === "string" ? data.display_label : "学习关联"}
        </button>
      ))}
    </div>
  ),
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StudentGraphPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("StudentGraphPage learner-facing presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localeState.value = "zh-CN";
    vi.mocked(api.getLearnerGraph).mockResolvedValue(graph);
    vi.mocked(api.getLearnerNodeDetail).mockResolvedValue({
      data: {
        id: knowledgeId,
        type: "LearnerKnowledgeState",
        mastery_score: 0.72,
        confidence: 0.86,
        assertions: [],
      },
    });
    vi.mocked(api.getLearnerAssertionDetail).mockResolvedValue({ data: {} });
  });

  it("shows mastery and readable relationships without rendering internal IDs or enums", async () => {
    renderPage();

    expect(await screen.findByText("72%")).toBeInTheDocument();
    expect(screen.getAllByText("掌握证据").length).toBeGreaterThan(0);
    expect(screen.getAllByText("待纠正理解").length).toBeGreaterThan(0);
    expect(screen.queryByText(evidenceId)).not.toBeInTheDocument();
    expect(screen.queryByText("HAS_MASTERY_EVIDENCE")).not.toBeInTheDocument();
  });

  it("keeps technical data collapsed behind an explicitly advanced disclosure", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "递归" }));

    const disclosure = await screen.findByText("技术详情（高级）");
    expect(disclosure.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("实体本体")).toBeInTheDocument();
    expect(screen.getByText("知识状态")).toBeInTheDocument();
  });

  it("opens one readable line with all relationships between the two nodes", async () => {
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "关系 待纠正理解 · 需要复习",
      }),
    );

    expect(await screen.findByText("关系本体")).toBeInTheDocument();
    expect(screen.getAllByText("学习进展关系").length).toBeGreaterThan(0);
    expect(screen.getByText("这条线包含的关系事实")).toBeInTheDocument();
    expect(screen.getByText("2 项")).toBeInTheDocument();
    expect(screen.getAllByText("待纠正理解").length).toBeGreaterThan(0);
    expect(screen.getAllByText("需要复习").length).toBeGreaterThan(0);
    expect(screen.getAllByText("待关注").length).toBeGreaterThan(0);
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.queryByText("HAS_MISCONCEPTION")).not.toBeInTheDocument();
    expect(api.getLearnerAssertionDetail).not.toHaveBeenCalled();
  });

  it("switches learner-facing graph copy to English", async () => {
    localeState.value = "en";
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Learner knowledge graph" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Average mastery")).toBeInTheDocument();
    expect(screen.getAllByText("Mastery evidence").length).toBeGreaterThan(0);
    expect(screen.queryByText("HAS_MASTERY_EVIDENCE")).not.toBeInTheDocument();
  });
});
