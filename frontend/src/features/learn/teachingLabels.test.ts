import { describe, expect, it } from "vitest";
import {
  assessmentTypeLabel,
  learnerDecisionLabel,
  teachingActionLabel,
} from "./teachingLabels";

describe("teaching enum labels", () => {
  it("maps every public teaching response enum to natural language", () => {
    expect(teachingActionLabel("EXPLAIN_CAUSALLY")).toBe("解释因果与原理");
    expect(assessmentTypeLabel("ANALYZE_BOUNDARY")).toBe("分析边界");
    expect(learnerDecisionLabel("REQUEST_MORE_EVIDENCE")).toBe(
      "需要更多掌握证据",
    );
  });

  it("turns future enum values into readable fallbacks", () => {
    expect(teachingActionLabel("FUTURE_SCAFFOLD")).toBe("其他教学动作");
    expect(assessmentTypeLabel("NEXT_GENERATION_CHECK")).toBe("其他掌握检测");
    expect(learnerDecisionLabel("")).toBe("其他学习建议");
  });

  it("supports English labels without exposing internal enum values", () => {
    expect(teachingActionLabel("EXPLAIN_CAUSALLY", "en")).toBe(
      "Explain causes and principles",
    );
    expect(assessmentTypeLabel("NEXT_GENERATION_CHECK", "en")).toBe(
      "Other mastery check",
    );
  });
});
