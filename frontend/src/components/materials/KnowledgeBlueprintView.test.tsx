import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeBlueprintView } from "./KnowledgeBlueprintView";

const graphNodeId = "11111111-1111-4111-8111-111111111111";

afterEach(cleanup);

function fixture(nodeId?: string) {
  return {
    title: "可验证蓝图",
    theories: [
      {
        candidate_key: "theory",
        name: "认知理论",
        description: "理论说明",
        source_span_ids: ["span-1"],
      },
    ],
    knowledge_points: [
      {
        candidate_key: "point",
        canonical_name: "递归",
        plain_definition: "用较小规模的自身定义问题。",
        formal_definition: "f(n) = f(n - 1) + c",
        graph_node_id: nodeId,
        prerequisites: [],
        source_span_ids: ["span-1"],
        six_level_plan: [
          {
            cognitive_level: 1,
            learning_objective: "识别递归",
            teaching_strategy: "展示一个基础示例",
            diagnostic_question: "哪个调用是递归调用？",
          },
        ],
      },
    ],
    examples: [
      {
        candidate_key: "example",
        knowledge_point_candidate_id: "point",
        content: "阶乘",
      },
    ],
    counterexamples: [
      {
        candidate_key: "counterexample",
        knowledge_point_candidate_id: "point",
        content: "无终止条件的自调用",
        boundary_explained: "缺少基础情形",
      },
    ],
    misconceptions: [
      {
        candidate_key: "misconception",
        knowledge_point_candidate_id: "point",
        statement: "递归总是更快",
        correction: "性能取决于问题与实现",
      },
    ],
    questions: [
      {
        candidate_key: "question",
        knowledge_point_candidate_id: "point",
        question: "请指出基础情形",
      },
    ],
    unresolved_ambiguities: [{ description: "术语存在歧义" }],
  };
}

function LearningTargetProbe() {
  const location = useLocation();
  const state = location.state as {
    learningTarget?: { name?: string; prompt?: string };
  } | null;
  return (
    <div>
      {state?.learningTarget?.name} | {state?.learningTarget?.prompt}
    </div>
  );
}

describe("KnowledgeBlueprintView", () => {
  it("renders product sections and keeps raw JSON collapsed", () => {
    render(
      <MemoryRouter>
        <KnowledgeBlueprintView value={fixture()} />
      </MemoryRouter>,
    );

    expect(screen.getByText("认知理论")).toBeInTheDocument();
    expect(screen.getByText("简明定义")).toBeInTheDocument();
    expect(screen.getByText("正式定义")).toBeInTheDocument();
    expect(screen.getByText("方法")).toBeInTheDocument();
    expect(screen.getByText("阶乘")).toBeInTheDocument();
    expect(screen.getByText("无终止条件的自调用")).toBeInTheDocument();
    expect(screen.getByText("递归总是更快")).toBeInTheDocument();
    expect(screen.getByText("请指出基础情形")).toBeInTheDocument();
    expect(screen.getByText("术语存在歧义")).toBeInTheDocument();
    expect(screen.getByText("技术原始数据")).toBeInTheDocument();
    expect(screen.queryByText('"knowledge_points"')).not.toBeInTheDocument();
    const graphButton = screen.getByRole("button", {
      name: "在图谱中查看",
    });
    expect(graphButton).toBeDisabled();
    expect(screen.getByText(/尚未发布到领域图谱/)).toBeInTheDocument();
  });

  it("passes a user-confirmable learning target through navigation state", () => {
    render(
      <MemoryRouter initialEntries={["/material"]}>
        <Routes>
          <Route
            path="/material"
            element={<KnowledgeBlueprintView value={fixture(graphNodeId)} />}
          />
          <Route path="/learn" element={<LearningTargetProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("link", { name: "开始学习" }));
    expect(screen.getByText(/递归 \| 我想学习“递归”/)).toBeInTheDocument();
  });

  it("enables graph navigation only for an explicit graph node id", () => {
    render(
      <MemoryRouter>
        <KnowledgeBlueprintView value={fixture(graphNodeId)} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "在图谱中查看" })).toHaveAttribute(
      "href",
      `/graph/domain?node=${graphNodeId}`,
    );
  });

  it("shows a safe error view for an incompatible future payload", () => {
    render(
      <MemoryRouter>
        <KnowledgeBlueprintView value={["unexpected"]} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/数据格式异常/)).toBeInTheDocument();
  });
});
