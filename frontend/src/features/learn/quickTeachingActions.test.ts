import { describe, expect, it } from "vitest";
import type { LocalPreferences } from "@/types/app";
import {
  mergeQuickPrompt,
  quickTeachingActions,
} from "./quickTeachingActions";

const preferences: LocalPreferences = {
  apiBaseUrl: "/api",
  uiLocale: "zh-CN",
  theme: "light",
  reducedMotion: false,
  graphDensity: "comfortable",
  defaultTeachingMode: "learn",
  explanationDetail: "detailed",
  prioritizeExamples: true,
  hintStrength: "light",
  reviewFrequency: "weekly",
  fontSize: "medium",
  graphLabelDensity: "balanced",
};

describe("quick teaching actions", () => {
  it("builds ordinary user prompts from local preferences", () => {
    const hint = quickTeachingActions.find((item) => item.id === "hint");
    const reExplain = quickTeachingActions.find(
      (item) => item.id === "re-explain",
    );
    expect(hint?.prompt(preferences)).toBe(
      "请只给我一个方向性提示，不要直接给出答案。",
    );
    expect(reExplain?.prompt(preferences)).toContain("更详细、分步骤地");
  });

  it("appends to a learner draft instead of discarding it", () => {
    expect(mergeQuickPrompt("我正在写的回答", "请给我提示")).toBe(
      "我正在写的回答\n请给我提示",
    );
    expect(mergeQuickPrompt("", "请给我提示")).toBe("请给我提示");
  });
});
