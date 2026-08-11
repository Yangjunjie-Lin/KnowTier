import { describe, expect, it } from "vitest";
import { calculateLearningPathStates, readableAction } from "./learningPath";
import type { LearnerModelItem } from "@/types/api";

function modelItem(
  id: string,
  override: Partial<LearnerModelItem> = {},
): LearnerModelItem {
  return {
    knowledge_point_id: id,
    knowledge_point: id,
    current_level: 1,
    mastery_score: 0,
    confidence: 0.5,
    evidence_count: 0,
    critical_misconceptions: [],
    prerequisites: [],
    all_prerequisites_mastered: true,
    prerequisite_status: "none",
    last_interaction_at: null,
    next_review_at: null,
    recommended_action: "REQUEST_MORE_EVIDENCE",
    ...override,
  };
}

describe("calculateLearningPathStates", () => {
  it("maps mastered, review, blocked, recommended, progress, and unknown states deterministically", () => {
    const items = [
      modelItem("mastered", { current_level: 2, mastery_score: 0.8 }),
      modelItem("review", {
        current_level: 3,
        mastery_score: 0.9,
        next_review_at: "2026-01-01T00:00:00Z",
      }),
      modelItem("blocked", {
        prerequisites: [
          {
            knowledge_point_id: "pre",
            knowledge_point: "前置概念",
            current_level: 1,
            mastery_score: 0.2,
            status: "not_mastered",
          },
        ],
        all_prerequisites_mastered: false,
        prerequisite_status: "not_mastered",
      }),
      modelItem("recommended"),
      modelItem("progress", { evidence_count: 2, mastery_score: 0.4 }),
    ];
    const states = calculateLearningPathStates(
      ["mastered", "review", "blocked", "recommended", "progress", "unknown"],
      new Map(items.map((item) => [item.knowledge_point_id, item])),
      new Date("2026-08-05T00:00:00Z"),
    );

    expect(states.map((state) => state.status)).toEqual([
      "mastered",
      "needs_review",
      "blocked",
      "recommended_next",
      "in_progress",
      "not_started",
    ]);
    expect(states[2]?.reason).toContain("前置概念");
    expect(states[5]?.reason).toContain("个人学习状态");
  });

  it("falls back safely for future recommendation values", () => {
    const item = modelItem("future", { recommended_action: "TRY_NEW_MODE" });
    const [state] = calculateLearningPathStates(
      [item.knowledge_point_id],
      new Map([[item.knowledge_point_id, item]]),
    );
    expect(state?.recommendedAction).toBe("继续当前学习计划");
    expect(readableAction("TRY_NEW_MODE", "en")).toBe("Continue the current learning plan");
  });
});
