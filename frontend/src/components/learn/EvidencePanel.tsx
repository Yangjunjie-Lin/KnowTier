import { ChevronDown, FlaskConical } from "lucide-react";
import { useState } from "react";
import { InsightPanelFrame } from "./InsightPanelFrame";
import type { LearningInsightPanelState } from "@/features/learn/useLearningInsights";
import type {
  EvidenceInsight,
  LearningTargetReference,
} from "@/lib/learningInsights";
import { cn } from "@/lib/utils";

function percentage(value: number | null): string {
  return value === null ? "后端未提供" : `${Math.round(value * 100)}%`;
}

function dateLabel(value: string | null): string {
  if (!value) return "后端未提供";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(parsed);
}

function EvidenceCard({ item }: { item: EvidenceInsight }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
            {item.evidenceForm}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400">
            掌握证据 · {item.cognitiveLevel ? `认知层级 L${item.cognitiveLevel}` : "认知层级未提供"}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200">
          置信度 {percentage(item.confidence)}
        </span>
      </div>
      {item.overallScore !== null && (
        <p className="mt-2 text-[11px] text-slate-500">
          总评分 {percentage(item.overallScore)}
        </p>
      )}
      {item.dimensions.length > 0 ? (
        <dl className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-slate-500">
          {item.dimensions.map((dimension) => (
            <div
              key={dimension.key}
              className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1 dark:bg-slate-800/60"
            >
              <dt>{dimension.label}</dt>
              <dd>{percentage(dimension.score)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-[11px] text-slate-400">后端未提供评分维度</p>
      )}
      <p className="mt-2 text-[11px] leading-5 text-slate-500">
        回答摘要：{item.answerSummary ?? "后端未提供"}
      </p>
      <button
        type="button"
        className="quiet-button mt-2 min-h-8 w-full justify-between px-2 text-xs"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        查看评分与来源
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
        />
      </button>
      {expanded && (
        <div className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2 text-[11px] leading-5 text-slate-500 dark:bg-slate-800/60">
          <p>评分说明：{item.graderExplanation ?? "后端未提供"}</p>
          <p>创建时间：{dateLabel(item.createdAt)}</p>
          <p>Session：{item.sessionId ? item.sessionId.slice(0, 8) : "后端未提供"}</p>
          <p>Turn：{item.turnId ? item.turnId.slice(0, 8) : "后端未提供"}</p>
          <p>
            用于当前掌握判断：
            {item.isUsedForCurrentMastery === null
              ? "后端未提供"
              : item.isUsedForCurrentMastery
                ? "是"
                : "否"}
          </p>
        </div>
      )}
    </li>
  );
}

export function EvidencePanel({
  target,
  items,
  state,
}: {
  target: LearningTargetReference | null;
  items: EvidenceInsight[];
  state: LearningInsightPanelState;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, 3);
  return (
    <InsightPanelFrame
      title="掌握证据"
      targetId={target?.id ?? null}
      state={state}
      hasContent={items.length > 0}
    >
      {items.length > 0 ? (
        <>
          <ul className="space-y-3">
            {visible.map((item) => (
              <EvidenceCard key={item.id} item={item} />
            ))}
          </ul>
          {items.length > 3 && (
            <button
              type="button"
              className="quiet-button mt-3 min-h-8 w-full justify-between px-2 text-xs"
              aria-expanded={showAll}
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? "收起" : `查看全部（${items.length}）`}
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  showAll && "rotate-180",
                )}
              />
            </button>
          )}
        </>
      ) : (
        <div className="space-y-2 text-xs leading-5 text-slate-400">
          <p>当前知识点还没有足够的独立掌握证据。</p>
          <p className="flex items-center gap-1.5">
            <FlaskConical className="h-3.5 w-3.5" />
            请完成本轮掌握检测。
          </p>
        </div>
      )}
    </InsightPanelFrame>
  );
}
