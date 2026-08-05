import { describe, expect, it } from "vitest";
import {
  adaptEvidence,
  adaptMisconceptions,
  adaptPrerequisites,
  resolveLearningTarget,
  type LearningTargetReference,
} from "./learningInsights";
import type {
  ChatResponse,
  CytoscapeGraph,
  EvidenceItem,
  GraphDetailResponse,
  LearnerModelItem,
  LearnerModelResponse,
  PrerequisiteState,
} from "@/types/api";

const target: LearningTargetReference = {
  id: "target-id",
  name: "目标知识点",
  source: "chat",
};

function modelItem(
  id: string,
  overrides: Partial<LearnerModelItem> = {},
): LearnerModelItem {
  return {
    knowledge_point_id: id,
    knowledge_point: `知识点 ${id}`,
    current_level: 1,
    mastery_score: 0.5,
    confidence: 0.7,
    evidence_count: 1,
    critical_misconceptions: [],
    prerequisites: [],
    all_prerequisites_mastered: true,
    prerequisite_status: "none",
    last_interaction_at: "2026-08-05T08:00:00Z",
    next_review_at: null,
    recommended_action: "REQUEST_MORE_EVIDENCE",
    ...overrides,
  };
}

function evidence(
  id: string,
  knowledgePointId: string,
  overrides: Partial<EvidenceItem> = {},
): EvidenceItem {
  return {
    id,
    knowledge_point_id: knowledgePointId,
    session_id: "session-id",
    turn_id: `turn-${id}`,
    evidence_type: "EXPLANATION",
    cognitive_level: 3,
    correctness_score: 0.8,
    reasoning_score: 0.7,
    independence_score: 0.6,
    transfer_score: 0.5,
    grader_confidence: 0.9,
    observed_misconceptions: [],
    grader_explanation: "真实评分说明",
    created_at: "2026-08-05T08:00:00Z",
    ...overrides,
  };
}

describe("learning insight adapters", () => {
  it("prefers the latest ChatResponse target over a navigation target", () => {
    const latest = {
      target_knowledge_point: { id: "chat-id", name: "聊天目标" },
    } as ChatResponse;
    expect(
      resolveLearningTarget(latest, { id: "navigation-id", name: "导航目标" }),
    ).toEqual({ id: "chat-id", name: "聊天目标", source: "chat" });
    expect(
      resolveLearningTarget(null, { id: "navigation-id", name: "导航目标" }),
    ).toEqual({ id: "navigation-id", name: "导航目标", source: "navigation" });
    expect(resolveLearningTarget(null, { name: "只有名称" })).toBeNull();
  });

  it("keeps every prerequisite and never turns a missing learner record into zero mastery", () => {
    const domainDetail: GraphDetailResponse = {
      data: {
        prerequisites: [
          { id: "p1", display_name: "前置一" },
          { id: "p2", canonical_name: "前置二" },
          { id: "p3", name: "前置三" },
        ],
      },
    };
    const learnerModel: LearnerModelResponse = {
      learner_id: "learner-id",
      workspace_id: "workspace-id",
      items: [
        modelItem("target-id", {
          prerequisite_status: "not_mastered",
          all_prerequisites_mastered: false,
          prerequisites: [
            {
              knowledge_point_id: "p1",
              knowledge_point: "前置一",
              mastery_score: 0.8,
              current_level: 2,
              status: "mastered",
            },
            {
              knowledge_point_id: "p2",
              knowledge_point: "前置二",
              mastery_score: 0,
              current_level: 1,
              status: "not_mastered",
            },
            {
              knowledge_point_id: "p3",
              knowledge_point: "前置三",
              mastery_score: 0,
              current_level: 1,
              status: "not_mastered",
            },
          ],
        }),
        modelItem("p1", {
          current_level: 2,
          mastery_score: 0.82,
        }),
        modelItem("p2", {
          current_level: 1,
          mastery_score: 0.4,
        }),
      ],
    };
    const result = adaptPrerequisites({
      target,
      learnerModel,
      domainDetail,
      now: Date.parse("2026-08-05T08:00:00Z"),
    });
    expect(result.items.map((item) => item.name)).toEqual([
      "前置一",
      "前置二",
      "前置三",
    ]);
    expect(result.items[0]).toMatchObject({
      statusLabel: "已掌握",
      masteryScore: 0.82,
    });
    expect(result.items[1]).toMatchObject({
      statusLabel: "前置阻塞",
      isBlocking: true,
    });
    expect(result.items[2]).toMatchObject({
      statusLabel: "尚无学习记录",
      masteryScore: null,
      currentLevel: null,
      isBlocking: true,
    });
  });

  it("maps mastered, blocked, review, learning, and unknown states conservatively", () => {
    const prerequisiteIds = ["mastered", "blocked", "review", "learning", "unknown"];
    const targetPrerequisites: PrerequisiteState[] = prerequisiteIds.map((id) => {
      const status: PrerequisiteState["status"] =
        id === "mastered" ? "mastered" : "not_mastered";
      return {
        knowledge_point_id: id,
        knowledge_point: id,
        mastery_score: 0.5,
        current_level: 2,
        status,
      };
    });
    const targetRecord = modelItem("target-id", {
      prerequisite_status: "not_mastered",
      all_prerequisites_mastered: false,
      prerequisites: targetPrerequisites,
    });
    const mutablePrerequisites = targetRecord.prerequisites as unknown as Array<
      Record<string, unknown>
    >;
    mutablePrerequisites[2]!.status = "review";
    delete mutablePrerequisites[3]!.status;
    mutablePrerequisites[4]!.status = "unknown";
    const result = adaptPrerequisites({
      target,
      learnerModel: {
        learner_id: "learner-id",
        workspace_id: "workspace-id",
        items: [
          targetRecord,
          modelItem("mastered", { mastery_score: 0.9, current_level: 3 }),
          modelItem("blocked", { mastery_score: 0.5, current_level: 2 }),
          modelItem("review", {
            mastery_score: 0.7,
            current_level: 2,
            recommended_action: "REVIEW",
          }),
          modelItem("learning", { mastery_score: 0.55, current_level: 2 }),
          modelItem("unknown", { mastery_score: 0.55, current_level: 2 }),
        ],
      },
      now: Date.parse("2026-08-05T08:00:00Z"),
    });
    expect(Object.fromEntries(result.items.map((item) => [item.id, item.statusLabel]))).toEqual({
      mastered: "已掌握",
      blocked: "前置阻塞",
      review: "需要复习",
      learning: "学习中",
      unknown: "状态未知",
    });
  });

  it("groups active and historical misconceptions from explicit learner data", () => {
    const graph: CytoscapeGraph = {
      elements: {
        nodes: [],
        edges: [
          {
            data: {
              id: "relation-active",
              assertion_id: "relation-active",
              source: "learner-id",
              target: target.id,
              predicate: "HAS_MISCONCEPTION",
              natural_language_description: "把后验概率当作先验概率",
              confidence: 0.8,
              valid_from: "2026-08-05T08:00:00Z",
              source_turn_id: "turn-active",
              evidence_id: "e1",
            },
          },
          {
            data: {
              id: "relation-old",
              assertion_id: "relation-old",
              source: "learner-id",
              target: target.id,
              predicate: "HAS_MISCONCEPTION",
              natural_language_description: "忽略条件事件",
              confidence: 0.7,
              valid_from: "2026-08-04T08:00:00Z",
              valid_to: "2026-08-05T07:00:00Z",
              superseded_by_assertion_id: "relation-new",
            },
          },
        ],
      },
      meta: {},
    };
    const groups = adaptMisconceptions({
      target,
      learnerModel: {
        learner_id: "learner-id",
        workspace_id: "workspace-id",
        items: [
          modelItem(target.id, {
            critical_misconceptions: ["把后验概率当作先验概率"],
          }),
        ],
      },
      learnerEvidence: {
        items: [
          evidence("e1", target.id, {
            observed_misconceptions: ["把后验概率当作先验概率"],
          }),
        ],
      },
      learnerGraph: graph,
    });
    expect(groups.current).toHaveLength(1);
    expect(groups.current[0]).toMatchObject({
      description: "把后验概率当作先验概率",
      statusLabel: "当前有效",
      relatedEvidenceCount: 1,
      isActive: true,
    });
    expect(groups.history).toHaveLength(1);
    expect(groups.history[0]).toMatchObject({
      description: "忽略条件事件",
      statusLabel: "已被新状态替代",
      isActive: false,
    });
  });

  it("does not construct a misconception from teacher response text", () => {
    const chat = {
      response: "教师说：你可能误解了条件概率。",
      target_knowledge_point: { id: target.id, name: target.name },
    } as ChatResponse;
    const resolved = resolveLearningTarget(chat, null);
    expect(resolved).not.toBeNull();
    expect(
      adaptMisconceptions({ target: resolved!, learnerModel: undefined }),
    ).toEqual({ current: [], history: [] });
  });

  it("keeps only evidence deterministically associated with the current knowledge point", () => {
    const missingAssociation = {
      ...evidence("missing", "other-id"),
      knowledge_point_id: undefined,
    } as unknown as EvidenceItem;
    const result = adaptEvidence({
      target,
      learnerEvidence: {
        items: [
          evidence("current", target.id),
          evidence("other", "other-id"),
          missingAssociation,
        ],
      },
    });
    expect(result.map((item) => item.id)).toEqual(["current"]);
    expect(result[0]?.dimensions.map((item) => item.label)).toEqual([
      "正确性",
      "推理质量",
      "独立性",
      "迁移能力",
    ]);
  });
});
