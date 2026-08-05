import { useState } from "react";
import { EvidencePanel } from "./EvidencePanel";
import { MisconceptionPanel } from "./MisconceptionPanel";
import { PrerequisitePanel } from "./PrerequisitePanel";
import { Sheet } from "@/components/shared/Sheet";
import type { UseLearningInsightsResult } from "@/features/learn/useLearningInsights";
import type { PrerequisiteInsight } from "@/lib/learningInsights";
import { cn } from "@/lib/utils";

type StatusTab = "prerequisites" | "misconceptions" | "evidence";

const tabs: Array<{ id: StatusTab; label: string }> = [
  { id: "prerequisites", label: "前置知识" },
  { id: "misconceptions", label: "误解" },
  { id: "evidence", label: "掌握证据" },
];

export function LearningStatusSheet({
  open,
  onOpenChange,
  result,
  onStartPrerequisite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: UseLearningInsightsResult;
  onStartPrerequisite: (item: PrerequisiteInsight) => void;
}) {
  const [tab, setTab] = useState<StatusTab>("prerequisites");
  const { insights, panels } = result;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="学习状态"
      eyebrow={insights.targetKnowledgePoint?.name ?? "等待目标确认"}
      description="查看当前知识点的实时前置知识、误解和掌握证据。"
      width="lg"
      placement="responsive"
    >
      <div
        className="mt-5 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900"
        role="tablist"
        aria-label="学习状态面板"
      >
        {tabs.map((item) => (
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
