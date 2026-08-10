import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { EvidencePanel } from "./EvidencePanel";
import { MisconceptionPanel } from "./MisconceptionPanel";
import { PrerequisitePanel } from "./PrerequisitePanel";
import { Sheet } from "@/components/shared/Sheet";
import {
  CognitiveBadge,
  MasteryBar,
} from "@/components/shared/LearningVisuals";
import type { UseLearningInsightsResult } from "@/features/learn/useLearningInsights";
import { learnerDecisionLabel } from "@/features/learn/teachingLabels";
import { useI18n } from "@/lib/i18n";
import type { PrerequisiteInsight } from "@/lib/learningInsights";
import { cn } from "@/lib/utils";
import type { ChatResponse, JsonObject } from "@/types/api";

type StatusTab =
  "turn" | "prerequisites" | "misconceptions" | "evidence" | "sources";

interface StatusTabItem {
  id: StatusTab;
  label: string;
  ariaLabel?: string;
  count?: number;
}

export function LearningStatusSheet({
  open,
  onOpenChange,
  result,
  latestResult,
  onStartPrerequisite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: UseLearningInsightsResult;
  latestResult?: ChatResponse;
  onStartPrerequisite: (item: PrerequisiteInsight) => void;
}) {
  const { pick } = useI18n();
  const [tab, setTab] = useState<StatusTab>("turn");
  const { insights, panels } = result;
  const availableTabs = useMemo<StatusTabItem[]>(() => {
    const items: StatusTabItem[] = [];
    if (latestResult) {
      items.push({ id: "turn", label: pick("本轮进展", "This turn") });
    }
    if (insights.prerequisites.length > 0) {
      items.push({
        id: "prerequisites",
        label: pick("前置知识", "Prerequisites"),
        count: insights.prerequisites.length,
      });
    }
    const misconceptionCount =
      insights.misconceptions.current.length +
      insights.misconceptions.history.length;
    if (misconceptionCount > 0) {
      items.push({
        id: "misconceptions",
        label: pick("需纠正", "To address"),
        ariaLabel: pick("误解", "Misconceptions"),
        count: misconceptionCount,
      });
    }
    if (insights.evidence.length > 0) {
      items.push({
        id: "evidence",
        label: pick("学习证据", "Evidence"),
        ariaLabel: pick("掌握证据", "Mastery evidence"),
        count: insights.evidence.length,
      });
    }
    if (latestResult?.sources.length) {
      items.push({
        id: "sources",
        label: pick("参考来源", "Sources"),
        count: latestResult.sources.length,
      });
    }
    return items;
  }, [insights, latestResult, pick]);
  const activeTab = availableTabs.some((item) => item.id === tab)
    ? tab
    : availableTabs[0]?.id;
  const isLoading = Object.values(panels).some(
    (panel) => panel.isLoading || panel.isRefreshing,
  );
  const hasError = Object.values(panels).some((panel) => panel.error);

  useEffect(() => {
    if (activeTab && activeTab !== tab) setTab(activeTab);
  }, [activeTab, tab]);

  const retryAll = () => {
    void Promise.allSettled([
      panels.prerequisites.retry(),
      panels.misconceptions.retry(),
      panels.evidence.retry(),
    ]);
  };
  const handleTabKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % availableTabs.length;
    }
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + availableTabs.length) % availableTabs.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = availableTabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = availableTabs[nextIndex];
    if (!next) return;
    setTab(next.id);
    document.getElementById(`learning-status-tab-${next.id}`)?.focus();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={pick("学习状态", "Learning status")}
      eyebrow={
        insights.targetKnowledgePoint?.name ??
        pick("学习详情", "Learning details")
      }
      description={pick(
        "这里只显示已经产生的学习记录；没有内容的分区会自动隐藏。",
        "Only available learning records are shown. Empty sections stay hidden.",
      )}
      width="lg"
      placement="responsive"
    >
      {availableTabs.length > 0 ? (
        <>
          <div
            className="mt-5 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:bg-slate-900"
            role="tablist"
            aria-label={pick("学习状态面板", "Learning status sections")}
          >
            {availableTabs.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`learning-status-tab-${item.id}`}
                aria-selected={activeTab === item.id}
                aria-controls={`learning-status-panel-${item.id}`}
                aria-label={item.ariaLabel ?? item.label}
                className={cn(
                  "min-h-9 shrink-0 rounded-lg px-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400",
                  activeTab === item.id
                    ? "bg-white text-[#3157D5] shadow-sm dark:bg-slate-800 dark:text-indigo-200"
                    : "text-slate-500",
                )}
                onClick={() => setTab(item.id)}
                onKeyDown={(event) => handleTabKey(event, index)}
              >
                {item.label}
                {item.count !== undefined && (
                  <span className="ml-1 text-[10px] opacity-70">
                    {item.count}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div
            className="mt-4"
            role="tabpanel"
            tabIndex={0}
            id={`learning-status-panel-${activeTab}`}
            aria-labelledby={`learning-status-tab-${activeTab}`}
          >
            {activeTab === "turn" && latestResult && (
              <TurnSummary result={latestResult} />
            )}
            {activeTab === "prerequisites" && (
              <PrerequisitePanel
                target={insights.targetKnowledgePoint}
                items={insights.prerequisites}
                structureSource={insights.prerequisiteStructureSource}
                state={panels.prerequisites}
                onStart={onStartPrerequisite}
              />
            )}
            {activeTab === "misconceptions" && (
              <MisconceptionPanel
                target={insights.targetKnowledgePoint}
                groups={insights.misconceptions}
                state={panels.misconceptions}
              />
            )}
            {activeTab === "evidence" && (
              <EvidencePanel
                target={insights.targetKnowledgePoint}
                items={insights.evidence}
                state={panels.evidence}
              />
            )}
            {activeTab === "sources" && latestResult && (
              <SourceSummary sources={latestResult.sources} />
            )}
          </div>
        </>
      ) : isLoading ? (
        <p
          className="mt-5 flex items-center gap-2 rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200"
          role="status"
        >
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {pick("正在更新学习进展…", "Updating learning progress…")}
        </p>
      ) : hasError ? (
        <div
          className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
          role="alert"
        >
          <p className="flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4" />
            {pick(
              "学习记录暂时无法加载",
              "Learning records are temporarily unavailable",
            )}
          </p>
          <p className="mt-1 text-xs opacity-80">
            {pick(
              "不影响继续提问或回答。",
              "You can continue asking and answering questions.",
            )}
          </p>
          <button
            type="button"
            className="secondary-button mt-3 min-h-8 px-3 py-1 text-xs"
            onClick={retryAll}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {pick("重试加载", "Retry")}
          </button>
        </div>
      ) : (
        <p className="mt-5 rounded-xl border border-dashed border-slate-200 p-5 text-sm leading-6 text-slate-500 dark:border-slate-700">
          {pick(
            "完成一轮学习后，可在这里按需查看学习进展和参考信息。",
            "After a learning turn, you can review progress and sources here when needed.",
          )}
        </p>
      )}
    </Sheet>
  );
}

function TurnSummary({ result }: { result: ChatResponse }) {
  const { locale, pick } = useI18n();
  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">
          {pick("本轮学习进展", "Progress this turn")}
        </h3>
        <CognitiveBadge level={result.cognitive_level} />
      </div>
      <MasteryBar
        value={result.learner_update.mastery_score}
        confidence={result.learner_update.confidence}
        label={pick("掌握度", "Mastery")}
      />
      <p className="mt-3 text-sm font-medium">
        {learnerDecisionLabel(result.learner_update.decision, locale)}
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        {result.learner_update.reason}
      </p>
    </section>
  );
}

function SourceSummary({ sources }: { sources: JsonObject[] }) {
  const { locale, pick } = useI18n();
  return (
    <ul
      className="space-y-2"
      aria-label={pick("参考来源", "Reference sources")}
    >
      {sources.map((source, index) => (
        <li
          key={sourceKey(source, index)}
          className="rounded-xl border border-slate-200 p-3 text-sm leading-6 text-slate-600 dark:border-slate-700 dark:text-slate-300"
        >
          {sourceLabel(source, index, locale)}
        </li>
      ))}
    </ul>
  );
}

function sourceLabel(
  source: JsonObject,
  index: number,
  locale: "zh-CN" | "en",
): string {
  for (const key of ["title", "filename", "name", "excerpt", "text"]) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 240);
    }
  }
  return locale === "en"
    ? `Reference source ${index + 1}`
    : `参考来源 ${index + 1}`;
}

function sourceKey(source: JsonObject, index: number): string {
  const value = source.id ?? source.source_span_id ?? source.document_id;
  return typeof value === "string" ? value : `source-${index}`;
}
