import { describe, expect, it } from "vitest";
import {
  adaptDomainVersionDetail,
  adaptLearnerVersionDetail,
  learnerDecisionLabel,
  versionStatusLabel,
} from "./versionDetails";

describe("version detail adapters", () => {
  it("adapts the real domain revision response without inventing missing deltas", () => {
    const detail = adaptDomainVersionDetail({
      id: "revision-id",
      sequence_number: 4,
      parent_revision_id: null,
      status: "APPLIED",
      projection_status: "PROJECTED",
      manifest: {
        knowledge_point_count: 8,
        assertion_count: 11,
        source_count: 2,
      },
      summary: {
        nodes_added: 3,
        nodes_updated: 1,
        assertions_added: 2,
        assertions_superseded: 1,
        conflict_count: 0,
      },
      created_by: "ingestion",
      model_run_id: "model-run-id",
      created_at: "2026-08-05T00:00:00Z",
      projected_at: "2026-08-05T00:01:00Z",
      future_extension: { safe: true },
    });

    expect(detail).not.toBeNull();
    expect(detail!.nodesAdded).toMatchObject({ provided: true, count: 3 });
    expect(detail!.relationsAdded.count).toBe(2);
    expect(detail!.relationsSuperseded.count).toBe(1);
    expect(detail!.conflicts.count).toBe(0);
    expect(detail!.sourceChanges).toEqual({
      provided: false,
      count: null,
      items: [],
    });
    expect(detail!.summaryNarrative).toContain("新增节点 3");
    expect(detail!.hasParentField).toBe(true);
    expect(detail!.manifestFacts).toEqual(
      expect.arrayContaining([{ label: "知识点总数", value: "8" }]),
    );
  });

  it("uses concrete item arrays when a future backend supplies them", () => {
    const detail = adaptDomainVersionDetail({
      summary: {
        added_nodes: [
          { properties: { display_name: "Limits" } },
          { id: "node-2" },
        ],
        source_changes: { count: 1, items: ["source.txt"] },
      },
    });

    expect(detail!.nodesAdded).toEqual({
      provided: true,
      count: 2,
      items: ["Limits", "未命名记录"],
    });
    expect(detail!.sourceChanges).toEqual({
      provided: true,
      count: 1,
      items: ["source.txt"],
    });
  });

  it("derives learner sections only from assertion, event, and summary fields", () => {
    const detail = adaptLearnerVersionDetail({
      id: "learner-revision-id",
      sequence_number: 2,
      session_id: "session-id",
      turn_id: "turn-id",
      assertions_added: 2,
      assertions_superseded: 1,
      change_summary: {
        target_knowledge_point_id: "knowledge-id",
        mastery_score: 0.72,
        current_level: 3,
        decision: "REQUEST_MORE_EVIDENCE",
      },
      assertions: [
        {
          id: "misconception-id",
          predicate: "HAS_MISCONCEPTION",
          subject_id: "learner-id",
          object_id: "knowledge-id",
          natural_language_description: "Confuses correlation with cause.",
        },
        {
          id: "evidence-id",
          predicate: "HAS_MASTERY_EVIDENCE",
          subject_id: "learner-id",
          object_id: "evidence-object-id",
          natural_language_description: "Explained the causal condition.",
        },
      ],
      events: [
        {
          id: "event-id",
          event_type: "LEARNER_GRAPH_DELTA",
          created_at: "2026-08-05T00:00:00Z",
          delta: {
            assertions_added: [
              { id: "misconception-id", predicate: "HAS_MISCONCEPTION" },
              { id: "evidence-id", predicate: "HAS_MASTERY_EVIDENCE" },
            ],
            assertions_superseded: ["old-assertion-id"],
          },
        },
      ],
    });

    expect(detail).not.toBeNull();
    expect(detail!.addedRelations).toHaveLength(2);
    expect(detail!.supersededRelationIds).toEqual(["old-assertion-id"]);
    expect(detail!.misconceptionChanges).toEqual([
      "Confuses correlation with cause.",
    ]);
    expect(detail!.evidenceChanges).toEqual([
      "Explained the causal condition.",
    ]);
    expect(detail!.masterySummary).toContain("72%");
    expect(detail!.masterySummary).toContain("无法计算增减");
    expect(detail!.recommendationLabel).toBe("收集更多掌握证据");
    expect(detail!.events.at(0)).toMatchObject({
      assertionsAdded: 2,
      assertionsSuperseded: 1,
    });
  });

  it("has safe labels and rejects incompatible top-level payloads", () => {
    expect(versionStatusLabel("FUTURE_STATUS")).toBe("其他处理状态");
    expect(learnerDecisionLabel("FUTURE_ACTION")).toBe("其他学习建议");
    expect(versionStatusLabel("APPLIED", "en")).toBe("Applied");
    expect(learnerDecisionLabel("FUTURE_ACTION", "en")).toBe("Other learning recommendation");
    expect(adaptDomainVersionDetail([])).toBeNull();
    expect(adaptLearnerVersionDetail("invalid")).toBeNull();
  });
});
