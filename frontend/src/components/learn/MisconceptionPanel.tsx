import { ChevronDown, GitBranch } from "lucide-react";
import { useState } from "react";
import { InsightPanelFrame } from "./InsightPanelFrame";
import type { LearningInsightPanelState } from "@/features/learn/useLearningInsights";
import type {
  LearningTargetReference,
  MisconceptionGroups,
  MisconceptionInsight,
} from "@/lib/learningInsights";
import { cn } from "@/lib/utils";

function percentage(value: number | null): string {
  return value === null ? "待评估" : `${Math.round(value * 100)}%`;
}

function dateLabel(value: string | null): string {
  if (!value) return "时间未知";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(parsed);
}

function MisconceptionCard({ item }: { item: MisconceptionInsight }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium leading-5 text-slate-800 dark:text-slate-100">
          {item.description}
        </p>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {item.statusLabel}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-500">
        <dt>置信度</dt>
        <dd className="text-right">{percentage(item.confidence)}</dd>
        <dt>最近发现</dt>
        <dd className="text-right">{dateLabel(item.lastSeenAt)}</dd>
        <dt>相关证据</dt>
        <dd className="text-right">{item.relatedEvidenceCount} 条</dd>
        <dt>仍然有效</dt>
        <dd className="text-right">
          {item.isActive === null ? "状态未知" : item.isActive ? "是" : "否"}
        </dd>
      </dl>
      <button
        type="button"
        className="quiet-button mt-2 min-h-8 w-full justify-between px-2 text-xs"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        查看处理与来源
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
        />
      </button>
      {expanded && (
        <div className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2 text-[11px] leading-5 text-slate-500 dark:bg-slate-800/60">
          <p>建议：{item.recommendedAction}</p>
          <p>首次发现：{dateLabel(item.firstSeenAt)}</p>
          <p>
            来源轮次：{item.sourceTurnId ? item.sourceTurnId.slice(0, 8) : "未记录"}
          </p>
          <p className="flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            来源关系：
            {item.sourceRelationId ? item.sourceRelationId.slice(0, 8) : "未记录"}
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
  const [showHistory, setShowHistory] = useState(false);
  const hasContent = groups.current.length > 0 || groups.history.length > 0;
  return (
    <InsightPanelFrame
      title="误解"
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
          当前没有记录到仍然有效的误解。
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
            历史误解（{groups.history.length}）
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
