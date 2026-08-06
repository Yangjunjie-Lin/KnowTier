import type { KeyboardEvent } from "react";
import { useState } from "react";
import { EvidencePanel } from "./EvidencePanel";
import { MisconceptionPanel } from "./MisconceptionPanel";
import { PrerequisitePanel } from "./PrerequisitePanel";
import { Sheet } from "@/components/shared/Sheet";
import {
  CognitiveBadge,
  MasteryBar,
} from "@/components/shared/LearningVisuals";
import { RuntimeModelBadge } from "@/components/shared/RuntimeModelBadge";
import type { UseLearningInsightsResult } from "@/features/learn/useLearningInsights";
import {
  learnerDecisionLabel,
  toolNameLabel,
} from "@/features/learn/teachingLabels";
import type { PrerequisiteInsight } from "@/lib/learningInsights";
import { cn } from "@/lib/utils";
import type { ChatResponse, JsonObject } from "@/types/api";

type StatusTab = "turn" | "prerequisites" | "misconceptions" | "evidence";

const tabs: Array<{ id: StatusTab; label: string }> = [
  { id: "turn", label: "本轮" },
  { id: "prerequisites", label: "前置知识" },
  { id: "misconceptions", label: "误解" },
  { id: "evidence", label: "掌握证据" },
];

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
  const [tab, setTab] = useState<StatusTab>("turn");
  const { insights, panels } = result;
  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    if (!next) return;
    setTab(next.id);
    document.getElementById(`learning-status-tab-${next.id}`)?.focus();
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="学习状态"
      eyebrow={insights.targetKnowledgePoint?.name ?? "等待目标确认"}
      description="查看本轮模型变化、来源、实时前置知识、误解和掌握证据。"
      width="lg"
      placement="responsive"
    >
      <div
        className="mt-5 grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900"
        role="tablist"
        aria-label="学习状态面板"
      >
        {tabs.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`learning-status-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`learning-status-panel-${item.id}`}
            className={cn(
              "min-h-9 rounded-md px-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400",
              tab === item.id
                ? "bg-white text-[#3157D5] shadow-sm dark:bg-slate-800 dark:text-indigo-200"
                : "text-slate-500",
            )}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => handleTabKey(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        className="mt-4"
        role="tabpanel"
        id={`learning-status-panel-${tab}`}
        aria-labelledby={`learning-status-tab-${tab}`}
      >
        {tab === "turn" && <TurnSummary result={latestResult} />}
        {tab === "prerequisites" && (
          <PrerequisitePanel
            target={insights.targetKnowledgePoint}
            items={insights.prerequisites}
            structureSource={insights.prerequisiteStructureSource}
            state={panels.prerequisites}
            onStart={onStartPrerequisite}
          />
        )}
        {tab === "misconceptions" && (
          <MisconceptionPanel
            target={insights.targetKnowledgePoint}
            groups={insights.misconceptions}
            state={panels.misconceptions}
          />
        )}
        {tab === "evidence" && (
          <EvidencePanel
            target={insights.targetKnowledgePoint}
            items={insights.evidence}
            state={panels.evidence}
          />
        )}
      </div>
    </Sheet>
  );
}

function TurnSummary({ result }: { result?: ChatResponse }) {
  if (!result) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 p-5 text-sm text-slate-500 dark:border-slate-700">
        完成一轮教学后，这里会显示掌握度、模型变化、来源与图谱更新。
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <RuntimeModelBadge role="teacher" label="Teacher" />
      <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">掌握与模型变化</h3>
          <CognitiveBadge level={result.cognitive_level} />
        </div>
        <MasteryBar
          value={result.learner_update.mastery_score}
          confidence={result.learner_update.confidence}
          label="本轮掌握度"
        />
        <p className="mt-3 text-sm font-medium">
          {learnerDecisionLabel(result.learner_update.decision)}
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {result.learner_update.reason}
        </p>
      </section>
      <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
        <h3 className="text-sm font-semibold">来源</h3>
        {result.sources.length > 0 ? (
          <ul className="mt-2 space-y-2 text-xs text-slate-600 dark:text-slate-300">
            {result.sources.map((source, index) => (
              <li key={sourceKey(source, index)}>{sourceLabel(source, index)}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-slate-500">本轮没有返回外部来源。</p>
        )}
      </section>
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <h3 className="text-sm font-semibold">工具调用</h3>
          {result.tool_usage?.tools.length ? (
            <ul className="mt-2 space-y-1 text-xs text-slate-500">
              {result.tool_usage.tools.map((tool, index) => (
                <li key={`${tool}-${index}`}>{toolNameLabel(tool)}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-slate-500">本轮未使用受控工具。</p>
          )}
        </div>
        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <h3 className="text-sm font-semibold">图谱更新</h3>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500">
            <dt>领域节点</dt>
            <dd className="text-right">+{result.graph_update.nodes_added}</dd>
            <dt>领域关系</dt>
            <dd className="text-right">+{result.graph_update.assertions_added}</dd>
            <dt>学生关系</dt>
            <dd className="text-right">
              +{result.learner_graph_update?.assertions_added ?? 0}
            </dd>
          </dl>
        </div>
      </section>
    </div>
  );
}

function sourceLabel(source: JsonObject, index: number): string {
  for (const key of ["title", "filename", "name", "text"]) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 180);
  }
  return `可追溯来源 ${index + 1}`;
}

function sourceKey(source: JsonObject, index: number): string {
  const value = source.id ?? source.source_span_id ?? source.document_id;
  return typeof value === "string" ? value : `source-${index}`;
}
