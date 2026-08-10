import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { InsightPanelFrame } from "./InsightPanelFrame";
import type { LearningInsightPanelState } from "@/features/learn/useLearningInsights";
import type {
  LearningTargetReference,
  MisconceptionGroups,
  MisconceptionInsight,
  MisconceptionStatus,
} from "@/lib/learningInsights";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { UiLocale } from "@/types/app";

function percentage(value: number | null, locale: UiLocale): string {
  return value === null
    ? locale === "en"
      ? "Not assessed"
      : "待评估"
    : `${Math.round(value * 100)}%`;
}

function dateLabel(value: string | null, locale: UiLocale): string {
  const unknown = locale === "en" ? "Unknown" : "时间未知";
  if (!value) return unknown;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? unknown
    : new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(parsed);
}

const misconceptionLabels: Record<MisconceptionStatus, [string, string]> = {
  pending: ["待澄清", "Needs clarification"],
  verify: ["需要验证", "Needs verification"],
  active: ["需要纠正", "Needs attention"],
  mitigated: ["已有改善", "Improved"],
  resolved: ["已解决", "Resolved"],
  superseded: ["已更新", "Updated"],
};

const misconceptionActions: Record<MisconceptionStatus, [string, string]> = {
  pending: [
    "通过一个中性问题确认当前理解。",
    "Use a neutral question to clarify your current understanding.",
  ],
  verify: [
    "用一道独立问题检查这个理解是否仍然存在。",
    "Use an independent question to check whether this understanding remains.",
  ],
  active: [
    "对比正确概念后完成一次纠正练习。",
    "Compare it with the correct concept, then complete a correction exercise.",
  ],
  mitigated: [
    "换一个情境再次检查，避免误解复现。",
    "Check again in a new context to prevent the misconception from returning.",
  ],
  resolved: [
    "保留记录，后续按需复习。",
    "Keep the record and review it when needed.",
  ],
  superseded: ["以最新学习状态为准。", "Use the latest learning status."],
};

function MisconceptionCard({ item }: { item: MisconceptionInsight }) {
  const { locale, pick } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const localeIndex = locale === "en" ? 1 : 0;
  const statusLabel =
    misconceptionLabels[item.status]?.[localeIndex] ??
    pick("需要确认", "Needs confirmation");
  const recommendation =
    misconceptionActions[item.status]?.[localeIndex] ??
    pick("稍后重新检查。", "Check again later.");
  return (
    <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium leading-5 text-slate-800 dark:text-slate-100">
          {item.description}
        </p>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {statusLabel}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-500">
        <dt>{pick("置信度", "Confidence")}</dt>
        <dd className="text-right">{percentage(item.confidence, locale)}</dd>
        <dt>{pick("最近发现", "Last seen")}</dt>
        <dd className="text-right">{dateLabel(item.lastSeenAt, locale)}</dd>
        <dt>{pick("相关证据", "Related evidence")}</dt>
        <dd className="text-right">
          {pick(
            `${item.relatedEvidenceCount} 条`,
            `${item.relatedEvidenceCount} records`,
          )}
        </dd>
        <dt>{pick("仍然有效", "Still active")}</dt>
        <dd className="text-right">
          {item.isActive === null
            ? pick("状态未知", "Unknown")
            : item.isActive
              ? pick("是", "Yes")
              : pick("否", "No")}
        </dd>
      </dl>
      <button
        type="button"
        className="quiet-button mt-2 min-h-8 w-full justify-between px-2 text-xs"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {pick("查看处理与来源", "View next step and source")}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded && (
        <div className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2 text-[11px] leading-5 text-slate-500 dark:bg-slate-800/60">
          <p>
            {pick("建议：", "Next step: ")}
            {recommendation}
          </p>
          <p>
            {pick("首次发现：", "First seen: ")}
            {dateLabel(item.firstSeenAt, locale)}
          </p>
          <p>
            {pick("依据：", "Basis: ")}
            {item.relatedEvidenceCount > 0
              ? pick(
                  `${item.relatedEvidenceCount} 条学习证据`,
                  `${item.relatedEvidenceCount} learning records`,
                )
              : pick("学习过程记录", "Learning activity")}
          </p>
        </div>
      )}
    </li>
  );
}

export function MisconceptionPanel({
  target,
  groups,
  state,
}: {
  target: LearningTargetReference | null;
  groups: MisconceptionGroups;
  state: LearningInsightPanelState;
}) {
  const { pick } = useI18n();
  const [showHistory, setShowHistory] = useState(false);
  const hasContent = groups.current.length > 0 || groups.history.length > 0;
  return (
    <InsightPanelFrame
      title={pick("误解", "Misconceptions")}
      targetId={target?.id ?? null}
      state={state}
      hasContent={hasContent}
    >
      {groups.current.length > 0 ? (
        <ul className="space-y-3">
          {groups.current.map((item) => (
            <MisconceptionCard key={item.id} item={item} />
          ))}
        </ul>
      ) : (
        <p className="text-xs leading-5 text-slate-400">
          {pick(
            "当前没有记录到仍然有效的误解。",
            "There are no active misconceptions for this topic.",
          )}
        </p>
      )}
      {groups.history.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          <button
            type="button"
            className="quiet-button min-h-8 w-full justify-between px-2 text-xs"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((value) => !value)}
          >
            {pick(
              `历史误解（${groups.history.length}）`,
              `Resolved misconceptions (${groups.history.length})`,
            )}
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                showHistory && "rotate-180",
              )}
            />
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-3">
              {groups.history.map((item) => (
                <MisconceptionCard key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      )}
    </InsightPanelFrame>
  );
}
