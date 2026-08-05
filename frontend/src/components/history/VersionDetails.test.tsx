import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DomainVersionDetail, LearnerVersionDetail } from "./VersionDetails";

afterEach(cleanup);

describe("VersionDetails", () => {
  it("renders domain revision metadata and marks unavailable source changes", () => {
    render(
      <DomainVersionDetail
        data={{
          id: "revision-id",
          sequence_number: 3,
          parent_revision_id: "parent-id",
          status: "APPLIED",
          projection_status: "PROJECTED",
          summary: {
            nodes_added: 4,
            assertions_added: 3,
            assertions_superseded: 1,
            conflict_count: 0,
          },
          created_by: "ingestion",
          model_run_id: "run-id",
          created_at: "2026-08-05T00:00:00Z",
          projected_at: "2026-08-05T00:01:00Z",
        }}
      />,
    );

    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByText("状态 · 已应用")).toBeInTheDocument();
    expect(screen.getByText("Projection · 已投影")).toBeInTheDocument();
    expect(screen.getByText("新增节点 4；新增关系 3；替代关系 1；记录冲突 0。")).toBeInTheDocument();
    expect(screen.getByText("来源变化")).toBeInTheDocument();
    expect(screen.getAllByText("后端未提供").length).toBeGreaterThan(0);
    expect(screen.getByText("原始数据（调试）")).toBeInTheDocument();
  });

  it("renders learner assertion groups, evidence, events and honest deltas", () => {
    render(
      <LearnerVersionDetail
        data={{
          id: "learner-revision-id",
          sequence_number: 5,
          session_id: "session-id",
          turn_id: "turn-id",
          assertions_added: 2,
          assertions_superseded: 1,
          created_at: "2026-08-05T00:00:00Z",
          change_summary: {
            target_knowledge_point_id: "knowledge-id",
            mastery_score: 0.8,
            current_level: 3,
            decision: "PROMOTE",
          },
          assertions: [
            {
              id: "evidence-id",
              predicate: "HAS_MASTERY_EVIDENCE",
              natural_language_description: "Independent explanation accepted.",
              confidence: 0.9,
            },
            {
              id: "misconception-id",
              predicate: "HAS_MISCONCEPTION",
              natural_language_description: "Still confuses two boundary cases.",
              confidence: 0.6,
            },
          ],
          events: [
            {
              id: "event-id",
              event_type: "LEARNER_GRAPH_DELTA",
              created_at: "2026-08-05T00:00:00Z",
              delta: {
                assertions_added: ["evidence-id", "misconception-id"],
                assertions_superseded: ["old-id"],
              },
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("v5")).toBeInTheDocument();
    expect(screen.getByText("Independent explanation accepted.")).toBeInTheDocument();
    expect(screen.getByText("Still confuses two boundary cases.")).toBeInTheDocument();
    expect(screen.getByText("old-id")).toBeInTheDocument();
    expect(screen.getByText(/本轮掌握度 80%/)).toBeInTheDocument();
    expect(screen.getByText(/无法计算前后差异/)).toBeInTheDocument();
    expect(screen.getByText("LEARNER_GRAPH_DELTA")).toBeInTheDocument();
  });

  it("handles incompatible version detail payloads safely", () => {
    render(<DomainVersionDetail data={["unexpected"]} />);
    expect(screen.getByText(/不是对象/)).toBeInTheDocument();
  });
});
