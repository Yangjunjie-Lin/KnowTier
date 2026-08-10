import type { LearnerModelItem, PrerequisiteState } from "@/types/api";
import type { UiLocale } from "@/types/app";

export type LearningPathStatus =
  | "mastered"
  | "in_progress"
  | "recommended_next"
  | "blocked"
  | "not_started"
  | "needs_review";

export interface LearningPathState {
  id: string;
  item: LearnerModelItem | null;
  status: LearningPathStatus;
  statusLabel: string;
  blockingPrerequisites: PrerequisiteState[];
  reason: string;
  recommendedAction: string;
}

const statusLabels: Record<LearningPathStatus, readonly [string, string]> = {
  mastered: ["已掌握", "Mastered"],
  in_progress: ["学习中", "In progress"],
  recommended_next: ["推荐下一步", "Recommended next"],
  blocked: ["被前置知识阻塞", "Prerequisites needed"],
  not_started: ["尚未开始", "Not started"],
  needs_review: ["需要复习", "Needs review"],
};

const actionLabels: Record<string, [string, string]> = {
  REMEDIATE: ["巩固基础并修正薄弱点", "Strengthen foundations and address weak areas"],
  REQUEST_MORE_EVIDENCE: ["继续练习以收集掌握证据", "Keep practicing to collect mastery evidence"],
  ASSESS_FOR_PROMOTION: ["进行掌握检测并尝试提升认知层级", "Take a mastery check and move to the next level"],
  REVIEW: ["安排复习以保持长期记忆", "Schedule a review for long-term retention"],
};

export function isLearnerItemMastered(item: LearnerModelItem): boolean {
  return item.mastery_score >= 0.75 && item.current_level >= 2;
}

function isReviewDue(item: LearnerModelItem, now: Date): boolean {
  if (!item.next_review_at) return false;
  const dueAt = Date.parse(item.next_review_at);
  return Number.isFinite(dueAt) && dueAt <= now.getTime();
}

export function readableAction(value: string, locale: UiLocale = "zh-CN"): string {
  const normalized = value.trim();
  if (!normalized) return locale === "en" ? "No recommendation yet" : "暂无建议";
  return actionLabels[normalized]?.[locale === "en" ? 1 : 0] ?? (locale === "en" ? "Continue the current learning plan" : "继续当前学习计划");
}

function blockingPrerequisites(item: LearnerModelItem): PrerequisiteState[] {
  return item.prerequisites.filter((prerequisite) => prerequisite.status !== "mastered");
}

export function calculateLearningPathStates(
  ids: string[],
  modelMap: ReadonlyMap<string, LearnerModelItem>,
  now = new Date(),
  locale: UiLocale = "zh-CN",
): LearningPathState[] {
  const en = locale === "en";
  const recommendedId = ids.find((id) => {
    const item = modelMap.get(id);
    return (
      item !== undefined &&
      !isLearnerItemMastered(item) &&
      !isReviewDue(item, now) &&
      blockingPrerequisites(item).length === 0
    );
  });

  return ids.map((id) => {
    const item = modelMap.get(id) ?? null;
    if (!item) {
      return {
        id,
        item,
        status: "not_started",
        statusLabel: statusLabels.not_started[en ? 1 : 0],
        blockingPrerequisites: [],
        reason: en ? "No learner progress is available for this topic yet." : "尚未生成该知识点的个人学习状态。",
        recommendedAction: en ? "No recommendation yet" : "暂无建议",
      };
    }

    const blockers = blockingPrerequisites(item);
    let status: LearningPathStatus;
    let reason: string;
    if (isReviewDue(item, now)) {
      status = "needs_review";
      reason = en ? "This topic is due for review." : "该知识点已到复习时间。";
    } else if (isLearnerItemMastered(item)) {
      status = "mastered";
      reason = en ? "Mastery is at least 75% and the cognitive level shows understanding." : "掌握度达到 75%，且认知层级至少为理解层。";
    } else if (blockers.length > 0) {
      status = "blocked";
      reason = en
        ? `Complete first: ${blockers.map((prerequisite) => prerequisite.knowledge_point).join(", ")}.`
        : `需先掌握：${blockers.map((prerequisite) => prerequisite.knowledge_point).join("、")}。`;
    } else if (id === recommendedId) {
      status = "recommended_next";
      reason = en ? "This is the first unmastered topic whose prerequisites are complete." : "这是路径中首个未掌握且前置条件已满足的知识点。";
    } else if (
      item.evidence_count > 0 ||
      item.last_interaction_at !== null ||
      item.mastery_score > 0
    ) {
      status = "in_progress";
      reason = en ? "Learning evidence exists, but mastery is not yet at the target level." : "已有学习互动或掌握证据，但尚未达到掌握阈值。";
    } else {
      status = "not_started";
      reason = en ? "No learning activity or mastery evidence is available yet." : "尚无学习互动或掌握证据。";
    }

    return {
      id,
      item,
      status,
      statusLabel: statusLabels[status][en ? 1 : 0],
      blockingPrerequisites: blockers,
      reason,
      recommendedAction: readableAction(item.recommended_action, locale),
    };
  });
}
