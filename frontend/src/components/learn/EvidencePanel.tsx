import { ChevronDown, FlaskConical } from "lucide-react";
import { useState } from "react";
import { InsightPanelFrame } from "./InsightPanelFrame";
import type { LearningInsightPanelState } from "@/features/learn/useLearningInsights";
import type {
  EvidenceInsight,
  LearningTargetReference,
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
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(parsed);
}

const evidenceForms: Readonly<Record<string, [string, string]>> = {
  RECOGNITION: ["识别", "Recognition"],
  EXPLANATION: ["解释", "Explanation"],
  WORKED_EXAMPLE: ["示例演练", "Worked example"],
  APPLICATION: ["应用", "Application"],
  CRITIQUE: ["批判分析", "Critical analysis"],
  TRANSFER: ["迁移", "Transfer"],
  CREATION: ["创造", "Creation"],
  SELF_REPORT: ["自我报告", "Self report"],
};

const dimensionLabels: Readonly<Record<string, [string, string]>> = {
  correctness: ["正确性", "Correctness"],
  reasoning: ["推理质量", "Reasoning"],
  relevance: ["相关性", "Relevance"],
  completeness: ["完整性", "Completeness"],
  independence: ["独立性", "Independence"],
  transfer: ["迁移能力", "Transfer"],
  question_understanding: ["问题理解", "Question understanding"],
};

function evidenceFormLabel(item: EvidenceInsight, locale: UiLocale): string {
  const label = evidenceForms[item.evidenceType.trim().toUpperCase()];
  return (
    label?.[locale === "en" ? 1 : 0] ??
    (locale === "en" ? "Learning evidence" : "其他学习证据")
  );
}

function dimensionLabel(key: string, locale: UiLocale): string {
  const label = dimensionLabels[key.trim().toLowerCase()];
  return (
    label?.[locale === "en" ? 1 : 0] ??
    (locale === "en" ? "Score dimension" : "评分维度")
  );
}

function EvidenceCard({ item }: { item: EvidenceInsight }) {
  const { locale, pick } = useI18n();
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
            {evidenceFormLabel(item, locale)}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400">
            {pick("掌握证据", "Mastery evidence")} ·{" "}
            {item.cognitiveLevel
              ? pick(
                  `认知层级 L${item.cognitiveLevel}`,
                  `Learning level L${item.cognitiveLevel}`,
                )
              : pick("认知层级未提供", "Learning level unavailable")}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200">
          {pick("置信度", "Confidence")} {percentage(item.confidence, locale)}
        </span>
      </div>
      {item.overallScore !== null && (
        <p className="mt-2 text-[11px] text-slate-500">
          {pick("总评分", "Overall score")}{" "}
          {percentage(item.overallScore, locale)}
        </p>
      )}
      {item.dimensions.length > 0 ? (
        <dl className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-slate-500">
          {item.dimensions.map((dimension) => (
            <div
              key={dimension.key}
              className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1 dark:bg-slate-800/60"
            >
              <dt>{dimensionLabel(dimension.key, locale)}</dt>
              <dd>{percentage(dimension.score, locale)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-[11px] text-slate-400">
          {pick("暂无评分维度", "No score dimensions yet")}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-5 text-slate-500">
        {pick("回答摘要：", "Answer summary: ")}
        {item.answerSummary ?? pick("暂无摘要", "No summary")}
      </p>
      <button
        type="button"
        className="quiet-button mt-2 min-h-8 w-full justify-between px-2 text-xs"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {pick("查看评分与来源", "View scoring and source")}
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
            {pick("评分说明：", "Scoring note: ")}
            {item.graderExplanation ?? pick("暂无说明", "No note")}
          </p>
          <p>
            {pick("创建时间：", "Created: ")}
            {dateLabel(item.createdAt, locale)}
          </p>
          <p>
            {pick("当前用途：", "Current use: ")}
            {item.isUsedForCurrentMastery === null
              ? pick("作为学习记录保留", "Kept as a learning record")
              : item.isUsedForCurrentMastery
                ? pick("已用于掌握判断", "Used in the mastery assessment")
                : pick("暂未用于掌握判断", "Not currently used for mastery")}
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
  const { pick } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, 3);
  return (
    <InsightPanelFrame
      title={pick("掌握证据", "Mastery evidence")}
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
              {showAll
                ? pick("收起", "Show less")
                : pick(
                    `查看全部（${items.length}）`,
                    `View all (${items.length})`,
                  )}
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
          <p>
            {pick(
              "当前知识点还没有足够的独立掌握证据。",
              "This topic does not have enough independent mastery evidence yet.",
            )}
          </p>
          <p className="flex items-center gap-1.5">
            <FlaskConical className="h-3.5 w-3.5" />
            {pick(
              "请完成本轮掌握检测。",
              "Complete the mastery check for this turn.",
            )}
          </p>
        </div>
      )}
    </InsightPanelFrame>
  );
}
