import type { LearnerModelItem, PrerequisiteState } from "@/types/api";

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

const statusLabels: Record<LearningPathStatus, string> = {
  mastered: "已掌握",
  in_progress: "学习中",
  recommended_next: "推荐下一步",
  blocked: "被前置知识阻塞",
  not_started: "尚未开始",
  needs_review: "需要复习",
};

const actionLabels: Record<string, string> = {
  REMEDIATE: "巩固基础并修正薄弱点",
  REQUEST_MORE_EVIDENCE: "继续练习以收集掌握证据",
  ASSESS_FOR_PROMOTION: "进行掌握检测并尝试提升认知层级",
  REVIEW: "安排复习以保持长期记忆",
};

export function isLearnerItemMastered(item: LearnerModelItem): boolean {
  return item.mastery_score >= 0.75 && item.current_level >= 2;
}

function isReviewDue(item: LearnerModelItem, now: Date): boolean {
  if (!item.next_review_at) return false;
  const dueAt = Date.parse(item.next_review_at);
  return Number.isFinite(dueAt) && dueAt <= now.getTime();
}

export function readableAction(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "暂无建议";
  return actionLabels[normalized] ?? normalized.replaceAll("_", " ").toLowerCase();
}

function blockingPrerequisites(item: LearnerModelItem): PrerequisiteState[] {
  return item.prerequisites.filter((prerequisite) => prerequisite.status !== "mastered");
}

export function calculateLearningPathStates(
  ids: string[],
  modelMap: ReadonlyMap<string, LearnerModelItem>,
  now = new Date(),
): LearningPathState[] {
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
        statusLabel: statusLabels.not_started,
        blockingPrerequisites: [],
        reason: "后端尚未提供该知识点的学生状态，使用中性状态展示。",
        recommendedAction: "暂无建议",
      };
    }

    const blockers = blockingPrerequisites(item);
    let status: LearningPathStatus;
    let reason: string;
    if (isReviewDue(item, now)) {
      status = "needs_review";
      reason = `复习时间已到（${item.next_review_at ?? "时间未知"}）。`;
    } else if (isLearnerItemMastered(item)) {
      status = "mastered";
      reason = "掌握度达到 75%，且认知层级至少为理解层。";
    } else if (blockers.length > 0) {
      status = "blocked";
      reason = `需先掌握：${blockers.map((prerequisite) => prerequisite.knowledge_point).join("、")}。`;
    } else if (id === recommendedId) {
      status = "recommended_next";
      reason = "这是路径中首个未掌握且前置条件已满足的知识点。";
    } else if (
      item.evidence_count > 0 ||
      item.last_interaction_at !== null ||
      item.mastery_score > 0
    ) {
      status = "in_progress";
      reason = "已有学习互动或掌握证据，但尚未达到掌握阈值。";
    } else {
      status = "not_started";
      reason = "尚无学习互动或掌握证据。";
    }

    return {
      id,
      item,
      status,
      statusLabel: statusLabels[status],
      blockingPrerequisites: blockers,
      reason,
      recommendedAction: readableAction(item.recommended_action),
    };
  });
}
