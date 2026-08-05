import type { RequestedMode } from "@/types/api";

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

const assessmentTypeLabels: Readonly<Record<string, string>> = {
  RECOGNIZE: "概念识别",
  REPRODUCE_PROCEDURE: "复现步骤",
  EXPLAIN_REASON: "解释原因",
  APPLY: "独立应用",
  ANALYZE_BOUNDARY: "分析边界",
  DESIGN_RESEARCH: "设计研究",
};

const learnerDecisionLabels: Readonly<Record<string, string>> = {
  PROMOTE: "提升认知层级",
  HOLD: "保持当前层级",
  REMEDIATE: "需要针对性补救",
  REVIEW_PREREQUISITE: "先复习前置知识",
  CHANGE_EXPLANATION: "更换讲解方式",
  REQUEST_MORE_EVIDENCE: "需要更多掌握证据",
};

export const teachingModes: ReadonlyArray<{
  id: RequestedMode;
  label: string;
  description: string;
}> = [
  { id: "learn", label: "学习", description: "循序讲解与诊断" },
  { id: "review", label: "复习", description: "回顾与间隔复习" },
  { id: "practice", label: "练习", description: "给出练习并反馈" },
  { id: "exam", label: "考试", description: "减少提示，检验掌握" },
  { id: "research", label: "研究", description: "跨来源探索关系" },
];

function humanizeIdentifier(value: string): string {
  const readable = value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
  if (!readable) return "未说明";
  return readable.charAt(0).toLocaleUpperCase() + readable.slice(1);
}

function mappedLabel(
  value: string,
  labels: Readonly<Record<string, string>>,
  category: string,
): string {
  const known = labels[value];
  return known ?? `其他${category}：${humanizeIdentifier(value)}`;
}

export function teachingActionLabel(value: string): string {
  return mappedLabel(value, teachingActionLabels, "教学动作");
}

export function assessmentTypeLabel(value: string): string {
  return mappedLabel(value, assessmentTypeLabels, "掌握检测");
}

export function learnerDecisionLabel(value: string): string {
  return mappedLabel(value, learnerDecisionLabels, "模型决策");
}

export function teachingModeLabel(value: RequestedMode): string {
  return teachingModes.find((item) => item.id === value)?.label ?? "学习";
}

export function toolNameLabel(value: string): string {
  return humanizeIdentifier(value);
}
