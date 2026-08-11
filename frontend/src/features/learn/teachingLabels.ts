import type { RequestedMode } from "@/types/api";
import type { UiLocale } from "@/types/app";

const teachingActionLabels: Readonly<Record<string, string>> = {
  DIAGNOSE: "诊断当前理解",
  EXPLAIN_INTUITIVELY: "直观讲解",
  DEMONSTRATE: "示范解题过程",
  EXPLAIN_CAUSALLY: "解释因果与原理",
  GUIDE_APPLICATION: "引导独立应用",
  CHALLENGE_WITH_BOUNDARY: "挑战边界条件",
  FORMULATE_RESEARCH_QUESTION: "形成研究问题",
  GIVE_HINT: "提供提示",
  REMEDIATE: "针对薄弱点补救",
  REVIEW_PREREQUISITE: "复习前置知识",
  ASSESS: "检查掌握情况",
  SUMMARIZE_PROGRESS: "总结学习进展",
};
const teachingActionLabelsEn: Readonly<Record<string, string>> = {
  DIAGNOSE: "Check current understanding",
  EXPLAIN_INTUITIVELY: "Explain intuitively",
  DEMONSTRATE: "Demonstrate the process",
  EXPLAIN_CAUSALLY: "Explain causes and principles",
  GUIDE_APPLICATION: "Guide independent application",
  CHALLENGE_WITH_BOUNDARY: "Explore boundary cases",
  FORMULATE_RESEARCH_QUESTION: "Form a research question",
  GIVE_HINT: "Give a hint",
  REMEDIATE: "Strengthen a weak area",
  REVIEW_PREREQUISITE: "Review prerequisites",
  ASSESS: "Check mastery",
  SUMMARIZE_PROGRESS: "Summarize progress",
};

const assessmentTypeLabels: Readonly<Record<string, string>> = {
  RECOGNIZE: "概念识别",
  REPRODUCE_PROCEDURE: "复现步骤",
  EXPLAIN_REASON: "解释原因",
  APPLY: "独立应用",
  ANALYZE_BOUNDARY: "分析边界",
  DESIGN_RESEARCH: "设计研究",
};
const assessmentTypeLabelsEn: Readonly<Record<string, string>> = {
  RECOGNIZE: "Recognize the concept",
  REPRODUCE_PROCEDURE: "Reproduce the process",
  EXPLAIN_REASON: "Explain the reason",
  APPLY: "Apply independently",
  ANALYZE_BOUNDARY: "Analyze boundaries",
  DESIGN_RESEARCH: "Design an investigation",
};

const learnerDecisionLabels: Readonly<Record<string, string>> = {
  PROMOTE: "提升认知层级",
  HOLD: "保持当前层级",
  REMEDIATE: "需要针对性补救",
  REVIEW_PREREQUISITE: "先复习前置知识",
  CHANGE_EXPLANATION: "更换讲解方式",
  REQUEST_MORE_EVIDENCE: "需要更多掌握证据",
};
const learnerDecisionLabelsEn: Readonly<Record<string, string>> = {
  PROMOTE: "Move to the next level",
  HOLD: "Keep the current level",
  REMEDIATE: "Strengthen this area",
  REVIEW_PREREQUISITE: "Review prerequisites first",
  CHANGE_EXPLANATION: "Try another explanation",
  REQUEST_MORE_EVIDENCE: "Collect more mastery evidence",
};

export const teachingModes: ReadonlyArray<{
  id: RequestedMode;
  label: string;
  description: string;
  labelEn: string;
  descriptionEn: string;
}> = [
  { id: "learn", label: "学习", description: "循序讲解与诊断", labelEn: "Learn", descriptionEn: "Guided explanation and diagnosis" },
  { id: "review", label: "复习", description: "回顾与间隔复习", labelEn: "Review", descriptionEn: "Recall and spaced review" },
  { id: "practice", label: "练习", description: "给出练习并反馈", labelEn: "Practice", descriptionEn: "Exercises with feedback" },
  { id: "exam", label: "考试", description: "减少提示，检验掌握", labelEn: "Assessment", descriptionEn: "Fewer hints and a mastery check" },
  { id: "research", label: "研究", description: "跨来源探索关系", labelEn: "Explore", descriptionEn: "Explore relationships across sources" },
];

function mappedLabel(
  value: string,
  labels: Readonly<Record<string, string>>,
  labelsEn: Readonly<Record<string, string>>,
  fallback: [string, string],
  locale: UiLocale,
): string {
  return (locale === "en" ? labelsEn : labels)[value] ?? fallback[locale === "en" ? 1 : 0];
}

export function teachingActionLabel(value: string, locale: UiLocale = "zh-CN"): string {
  return mappedLabel(value, teachingActionLabels, teachingActionLabelsEn, ["其他教学动作", "Other teaching action"], locale);
}

export function assessmentTypeLabel(value: string, locale: UiLocale = "zh-CN"): string {
  return mappedLabel(value, assessmentTypeLabels, assessmentTypeLabelsEn, ["其他掌握检测", "Other mastery check"], locale);
}

export function learnerDecisionLabel(value: string, locale: UiLocale = "zh-CN"): string {
  return mappedLabel(value, learnerDecisionLabels, learnerDecisionLabelsEn, ["其他学习建议", "Other learning recommendation"], locale);
}

export function teachingModeLabel(value: RequestedMode, locale: UiLocale = "zh-CN"): string {
  const mode = teachingModes.find((item) => item.id === value) ?? teachingModes[0]!;
  return locale === "en" ? mode.labelEn : mode.label;
}

const toolLabels: Readonly<Record<string, [string, string]>> = {
  RETRIEVE_DOCUMENTS: ["查找学习资料", "Find learning materials"],
  LOOKUP_GRAPH: ["查看知识关系", "Look up knowledge relationships"],
  UPDATE_LEARNER_MODEL: ["更新学习进展", "Update learning progress"],
  SAVE_EVIDENCE: ["保存掌握证据", "Save mastery evidence"],
};

export function toolNameLabel(value: string, locale: UiLocale = "zh-CN"): string {
  const label = toolLabels[value.trim().toUpperCase()];
  return label?.[locale === "en" ? 1 : 0] ?? (locale === "en" ? "Learning support tool" : "学习辅助工具");
}
