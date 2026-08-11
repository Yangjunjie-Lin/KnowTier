import { describe, expect, it } from "vitest";
import {
  buildLearnerGraphPresentation,
  learnerGraphRelationLabel,
  learnerGraphRelationTypes,
  summarizeLearnerGraph,
} from "./learnerGraphPresentation";
import type { CytoscapeGraph } from "@/types/api";

const learnerId = "11111111-1111-4111-8111-111111111111";
const knowledgeId = "22222222-2222-4222-8222-222222222222";
const evidenceId = "33333333-3333-4333-8333-333333333333";

const graph: CytoscapeGraph = {
  elements: {
    nodes: [
      { data: { id: learnerId, type: "Learner", label: "Ada" } },
      {
        data: {
          id: knowledgeId,
          type: "LearnerKnowledgeState",
          label: "递归",
          mastery_score: 0.72,
          confidence: 0.8,
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
      {
        data: {
          id: "edge-old",
          assertion_id: "edge-old",
          source: learnerId,
          target: knowledgeId,
          relation_type: "RECENTLY_PRACTICED",
          valid_to: "2026-01-01T00:00:00Z",
        },
      },
    ],
  },
  meta: { learner_graph_revision_id: "revision-id" },
};

describe("learner graph presentation", () => {
  it("replaces internal resource identifiers and enums with learner-facing text", () => {
    const result = buildLearnerGraphPresentation(graph);
    const resource = result.elements.nodes.find(
      ({ data }) => data.id === evidenceId,
    );
    expect(resource?.data.label).toBe("掌握证据");
    expect(resource?.data.label).not.toContain(evidenceId);
    expect(result.elements.edges).toHaveLength(2);
    const misconception = result.elements.edges.find(
      ({ data }) => data.relation_type === "HAS_MISCONCEPTION",
    );
    expect(misconception?.data.display_label).toBe("2 条学习关系");
    expect(misconception?.data.relationship_count).toBe(2);
    expect(misconception?.data.relation_types).toEqual([
      "HAS_MISCONCEPTION",
      "REQUIRES_REVIEW",
    ]);
    expect(misconception?.data.relationship_summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          display_label: "待纠正理解",
          display_description: "待纠正：把终止条件写反了",
        }),
        expect.objectContaining({ display_label: "需要复习", confidence: 0.75 }),
      ]),
    );
    expect(JSON.stringify(result.meta)).toContain("revision-id");
  });

  it("keeps superseded relationships available only when history is requested", () => {
    expect(buildLearnerGraphPresentation(graph).elements.edges).toHaveLength(2);
    const withHistory = buildLearnerGraphPresentation(graph, true);
    expect(withHistory.elements.edges).toHaveLength(2);
    expect(
      withHistory.elements.edges.find(({ data }) => data.target === knowledgeId)
        ?.data.relationship_count,
    ).toBe(3);
  });

  it("summarizes mastery and attention without exposing backend vocabulary", () => {
    const result = buildLearnerGraphPresentation(graph);
    expect(summarizeLearnerGraph(result)).toEqual({
      knowledgePointCount: 1,
      evaluatedCount: 1,
      averageMastery: 0.72,
      attentionCount: 1,
    });
    expect(new Set(learnerGraphRelationTypes(result))).toEqual(
      new Set([
        "HAS_MASTERY_EVIDENCE",
        "HAS_MISCONCEPTION",
        "REQUIRES_REVIEW",
      ]),
    );
    expect(learnerGraphRelationLabel("UNKNOWN_BACKEND_VALUE")).toBe("学习关联");
  });

  it("provides the same safe presentation in English", () => {
    const result = buildLearnerGraphPresentation(graph, false, "en");
    const evidence = result.elements.nodes.find(
      ({ data }) => data.id === evidenceId,
    );
    expect(evidence?.data.label).toBe("Mastery evidence");
    expect(evidence?.data.label).not.toContain(evidenceId);
    expect(learnerGraphRelationLabel("HAS_MISCONCEPTION", "en")).toBe(
      "Needs correction",
    );
    expect(learnerGraphRelationLabel("UNKNOWN_BACKEND_VALUE", "en")).toBe(
      "Learning link",
    );
  });
});
