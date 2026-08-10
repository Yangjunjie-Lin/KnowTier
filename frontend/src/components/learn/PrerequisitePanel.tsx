import { ArrowRight, BookOpenCheck } from "lucide-react";
import { InsightPanelFrame } from "./InsightPanelFrame";
import type { LearningInsightPanelState } from "@/features/learn/useLearningInsights";
import type {
  LearningTargetReference,
  PrerequisiteInsight,
  PrerequisiteStructureSource,
} from "@/lib/learningInsights";

function percentage(value: number | null): string {
  return value === null ? "待评估" : `${Math.round(value * 100)}%`;
}

function blockingLabel(value: boolean | null): string {
  if (value === null) return "时间未知";
  return value ? "是" : "否";
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
  return (
    <InsightPanelFrame
      title="前置知识"
      targetId={target?.id ?? null}
      state={state}
      hasContent={items.length > 0}
    >
      {items.length > 0 ? (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {item.name}
                </p>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {item.statusLabel}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-500">
                <dt>认知层级</dt>
                <dd className="text-right">
                  {item.currentLevel ? `L${item.currentLevel}` : "待评估"}
                </dd>
                <dt>掌握度</dt>
                <dd className="text-right">{percentage(item.masteryScore)}</dd>
                <dt>阻塞当前目标</dt>
                <dd className="text-right">{blockingLabel(item.isBlocking)}</dd>
              </dl>
              <p className="mt-2 text-[11px] leading-5 text-slate-500">
                {item.statusExplanation}
              </p>
              <p className="mt-1 text-[11px] leading-5 text-slate-400">
                建议：{item.recommendedAction}
              </p>
              <button
                type="button"
                className="secondary-button mt-3 min-h-8 w-full px-3 py-1.5 text-xs"
                onClick={() => onStart(item)}
              >
                <BookOpenCheck className="h-3.5 w-3.5" />
                {item.status === "mastered" ? "开始复习" : "开始学习"}
                <ArrowRight className="ml-auto h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs leading-5 text-slate-400">
          {structureSource === "unavailable"
            ? "后端暂未提供前置知识"
            : "该知识点没有已知前置要求"}
        </p>
      )}
    </InsightPanelFrame>
  );
}
