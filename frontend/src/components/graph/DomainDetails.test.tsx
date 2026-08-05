import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DomainAssertionDetail, DomainNodeDetail } from "./DomainDetails";

afterEach(cleanup);

const nodeId = "11111111-1111-4111-8111-111111111111";

const nodeDetail = {
  node: {
    id: nodeId,
    node_type: "KnowledgePoint",
    properties: {
      canonical_name: "条件概率",
      plain_language_definition: "在已有条件下衡量事件发生的可能性。",
      formal_definition: "P(A|B)=P(A∩B)/P(B)",
      knowledge_domain: "概率论",
    },
    epistemic_status: "CONFIRMED",
  },
  theories: [
    {
      id: "theory-id",
      node_type: "Theory",
      properties: { name: "概率论" },
    },
  ],
  prerequisites: [],
  related_knowledge_points: [
    {
      id: "related-id",
      node_type: "KnowledgePoint",
      properties: { display_name: "贝叶斯更新" },
    },
  ],
  incoming_assertions: [],
  outgoing_assertions: [
    {
      id: "relation-id",
      predicate: "ENABLES",
      object_id: "related-id",
      description: "条件概率为贝叶斯更新提供基础。",
      active: true,
    },
  ],
  learning_stages: [
    {
      id: "stage-id",
      properties: {
        cognitive_level: 1,
        learning_objective: "识别条件概率问题",
        diagnostic_question: "条件是什么？",
      },
    },
  ],
  sources: [
    {
      id: "span-id",
      page_number: 2,
      source_document: { properties: { filename: "probability.txt" } },
    },
  ],
  graph_revision: "revision-id",
};

function TargetProbe() {
  const location = useLocation();
  const state = location.state as {
    learningTarget?: { name?: string; id?: string };
  } | null;
  return (
    <p>
      {state?.learningTarget?.name} · {state?.learningTarget?.id}
    </p>
  );
}

describe("DomainDetails", () => {
  it("renders a productized node detail and explicit actions", () => {
    const focus = vi.fn();
    render(
      <MemoryRouter initialEntries={["/graph"]}>
        <Routes>
          <Route
            path="/graph"
            element={<DomainNodeDetail data={nodeDetail} onFocus={focus} />}
          />
          <Route path="/learn" element={<TargetProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("条件概率")).toBeInTheDocument();
    expect(screen.getByText("简明定义")).toBeInTheDocument();
    expect(screen.getByText("正式定义")).toBeInTheDocument();
    expect(screen.getByText("贝叶斯更新")).toBeInTheDocument();
    expect(screen.getByText("条件概率为贝叶斯更新提供基础。")).toBeInTheDocument();
    expect(screen.getByText("probability.txt · 第 2 页")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加载局部子图" }));
    expect(focus).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("link", { name: "开始学习" }));
    expect(screen.getByText(`${nodeId}`, { exact: false })).toBeInTheDocument();
  });

  it("makes the natural-language assertion primary and shows history", () => {
    render(
      <MemoryRouter>
        <DomainAssertionDetail
          data={{
            assertion: {
              id: "assertion-id",
              predicate_key: "REQUIRES",
              natural_language_description: "微积分需要先掌握极限。",
              confidence: 0.9,
              epistemic_status: "PROPOSED",
              valid_from: "2026-08-05T00:00:00Z",
            },
            subject: { display_name: "微积分", entity_type: "KnowledgePoint" },
            object: { display_name: "极限", entity_type: "KnowledgePoint" },
            conflicts: [{ id: "conflict", description: "来源存在分歧" }],
            superseded_relation: {
              id: "old-id",
              natural_language_description: "旧关系",
            },
            superseding_relation: {
              id: "new-id",
              natural_language_description: "新关系",
            },
            sources: [],
            graph_revision: "revision-id",
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("微积分需要先掌握极限。")).toBeInTheDocument();
    expect(screen.getByText("需要先掌握")).toBeInTheDocument();
    expect(screen.getByText("来源存在分歧")).toBeInTheDocument();
    expect(screen.getByText("旧关系")).toBeInTheDocument();
    expect(screen.getByText("新关系")).toBeInTheDocument();
    expect(screen.getByText("原始数据（调试）")).toBeInTheDocument();
  });

  it("does not crash on a future incompatible detail shape", () => {
    render(
      <MemoryRouter>
        <DomainNodeDetail data={["unexpected"]} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/不是对象/)).toBeInTheDocument();
  });
});
