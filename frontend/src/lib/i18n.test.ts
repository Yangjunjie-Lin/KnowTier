import { describe, expect, it } from "vitest";
import {
  backendLabel,
  entityLabel,
  evidenceLabel,
  providerLabel,
  relationLabel,
  translate,
} from "./i18n";

describe("interface localization", () => {
  it("translates shell copy and interpolation", () => {
    expect(translate("zh-CN", "shell.learner", { name: "小林" })).toBe(
      "学习档案：小林",
    );
    expect(translate("en", "shell.learner", { name: "Alex" })).toBe(
      "Profile: Alex",
    );
    expect(translate("en", "nav.studentGraph")).toBe("My knowledge map");
  });

  it("maps backend identifiers to product language", () => {
    expect(relationLabel("REQUIRES", "zh-CN")).toBe("需要先掌握");
    expect(relationLabel("REQUIRES", "en")).toBe("Requires");
    expect(entityLabel("LearnerKnowledgeState", "en")).toBe(
      "Learning topic",
    );
    expect(evidenceLabel("ASSESSMENT", "en")).toBe("Mastery check");
    expect(providerLabel("openai-compatible", "zh-CN")).toBe(
      "自定义兼容服务",
    );
  });

  it("never exposes an unknown backend identifier as primary copy", () => {
    expect(backendLabel("INTERNAL_FUTURE_VALUE", "zh-CN")).toBe("其他");
    expect(backendLabel("INTERNAL_FUTURE_VALUE", "en")).toBe("Other");
  });
});
