import { ArrowRight, BookOpenCheck } from "lucide-react";
import { InsightPanelFrame } from "./InsightPanelFrame";
import type { LearningInsightPanelState } from "@/features/learn/useLearningInsights";
import type {
  LearningTargetReference,
  PrerequisiteInsight,
  PrerequisiteStatus,
  PrerequisiteStructureSource,
} from "@/lib/learningInsights";
import { useI18n } from "@/lib/i18n";
import type { UiLocale } from "@/types/app";

function percentage(value: number | null, locale: UiLocale): string {
  return value === null
    ? locale === "en"
      ? "Not assessed"
      : "待评估"
    : `${Math.round(value * 100)}%`;
}

function blockingLabel(value: boolean | null, locale: UiLocale): string {
  if (value === null) return locale === "en" ? "Unknown" : "未知";
  return value
    ? locale === "en"
      ? "Yes"
      : "是"
    : locale === "en"
      ? "No"
      : "否";
}

const prerequisiteCopy: Record<
  PrerequisiteStatus,
  {
    label: [string, string];
    explanation: [string, string];
    action: [string, string];
  }
> = {
  mastered: {
    label: ["已掌握", "Mastered"],
    explanation: [
      "已有记录表明可以继续当前目标。",
      "Your records indicate that you can continue with the current goal.",
    ],
    action: ["可快速复习后继续。", "Review briefly if needed, then continue."],
  },
  learning: {
    label: ["学习中", "In progress"],
    explanation: [
      "已有学习记录，还需要进一步巩固。",
      "You have started this topic and need a little more practice.",
    ],
    action: [
      "继续练习并完成一次独立检测。",
      "Keep practising and complete an independent check.",
    ],
  },
  review: {
    label: ["建议复习", "Review recommended"],
    explanation: [
      "当前记录提示先补充这部分基础。",
      "Your current record suggests reviewing this foundation first.",
    ],
    action: [
      "完成针对性复习后再返回当前目标。",
      "Review this topic, then return to the current goal.",
    ],
  },
  blocked: {
    label: ["需要先掌握", "Required first"],
    explanation: [
      "这项前置知识可能影响当前目标。",
      "This prerequisite may be blocking the current goal.",
    ],
    action: ["优先学习这项前置知识。", "Learn this prerequisite first."],
  },
  "no-record": {
    label: ["尚无记录", "No record yet"],
    explanation: [
      "已知需要这项知识，但还没有个人学习记录。",
      "This topic is required, but you do not have a learning record for it yet.",
    ],
    action: [
      "开始学习以建立首条记录。",
      "Start learning to create your first record.",
    ],
  },
  unknown: {
    label: ["待确认", "Needs confirmation"],
    explanation: [
      "现有信息不足以判断掌握状态。",
      "There is not enough information to assess this prerequisite.",
    ],
    action: [
      "先进行简短复习，或稍后刷新。",
      "Review briefly or refresh later.",
    ],
  },
};

function statusCopy(status: PrerequisiteStatus, locale: UiLocale) {
  const copy = prerequisiteCopy[status] ?? prerequisiteCopy.unknown;
  const index = locale === "en" ? 1 : 0;
  return {
    label: copy.label[index],
    explanation: copy.explanation[index],
    action: copy.action[index],
  };
}

export function PrerequisitePanel({
  target,
  items,
  structureSource,
  state,
  onStart,
}: {
  target: LearningTargetReference | null;
  items: PrerequisiteInsight[];
  structureSource: PrerequisiteStructureSource;
  state: LearningInsightPanelState;
  onStart: (item: PrerequisiteInsight) => void;
}) {
  const { locale, pick } = useI18n();
  return (
    <InsightPanelFrame
      title={pick("前置知识", "Prerequisites")}
      targetId={target?.id ?? null}
      state={state}
      hasContent={items.length > 0}
    >
      {items.length > 0 ? (
        <ul className="space-y-3">
          {items.map((item) => {
            const copy = statusCopy(item.status, locale);
            return (
              <li
                key={item.id}
                className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {item.name}
                  </p>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {copy.label}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-500">
                  <dt>{pick("认知层级", "Learning level")}</dt>
                  <dd className="text-right">
                    {item.currentLevel
                      ? `L${item.currentLevel}`
                      : pick("待评估", "Not assessed")}
                  </dd>
                  <dt>{pick("掌握度", "Mastery")}</dt>
                  <dd className="text-right">
                    {percentage(item.masteryScore, locale)}
                  </dd>
                  <dt>{pick("影响当前目标", "Affects current goal")}</dt>
                  <dd className="text-right">
                    {blockingLabel(item.isBlocking, locale)}
                  </dd>
                </dl>
                <p className="mt-2 text-[11px] leading-5 text-slate-500">
                  {copy.explanation}
                </p>
                <p className="mt-1 text-[11px] leading-5 text-slate-400">
                  {pick("建议：", "Next step: ")}
                  {copy.action}
                </p>
                <button
                  type="button"
                  className="secondary-button mt-3 min-h-8 w-full px-3 py-1.5 text-xs"
                  onClick={() => onStart(item)}
                >
                  <BookOpenCheck className="h-3.5 w-3.5" />
                  {item.status === "mastered"
                    ? pick("开始复习", "Review")
                    : pick("开始学习", "Start learning")}
                  <ArrowRight className="ml-auto h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs leading-5 text-slate-400">
          {structureSource === "unavailable"
            ? pick(
                "暂时没有可用的前置知识信息",
                "Prerequisite information is temporarily unavailable",
              )
            : pick(
                "该知识点没有已知前置要求",
                "This topic has no known prerequisites",
              )}
        </p>
      )}
    </InsightPanelFrame>
  );
}
