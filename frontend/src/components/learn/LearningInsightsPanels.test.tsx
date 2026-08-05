import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EvidencePanel } from "./EvidencePanel";
import { LearningStatusSheet } from "./LearningStatusSheet";
import { MisconceptionPanel } from "./MisconceptionPanel";
import { PrerequisitePanel } from "./PrerequisitePanel";
import type {
  LearningInsightPanelState,
  UseLearningInsightsResult,
} from "@/features/learn/useLearningInsights";
import type {
  EvidenceInsight,
  LearningTargetReference,
  MisconceptionInsight,
  PrerequisiteInsight,
} from "@/lib/learningInsights";

const target: LearningTargetReference = {
  id: "target-id",
  name: "贝叶斯定理",
  source: "chat",
};

function panelState(
  overrides: Partial<LearningInsightPanelState> = {},
): LearningInsightPanelState {
  return {
    isLoading: false,
    isRefreshing: false,
    error: null,
    hasPartialError: false,
    lastUpdatedAt: "2026-08-05T08:00:00Z",
    retry: () => Promise.resolve(),
    ...overrides,
  };
}

const prerequisite: PrerequisiteInsight = {
  id: "prerequisite-id",
  name: "条件概率",
  currentLevel: null,
  masteryScore: null,
  status: "no-record",
  statusLabel: "尚无学习记录",
  isBlocking: true,
  statusExplanation: "尚无个人记录。",
  recommendedAction: "开始学习。",
};

const misconception: MisconceptionInsight = {
  id: "misconception-id",
  description: "把后验概率当成先验概率",
  status: "active",
  statusLabel: "当前有效",
  confidence: 0.8,
  firstSeenAt: "2026-08-05T07:00:00Z",
  lastSeenAt: "2026-08-05T08:00:00Z",
  relatedEvidenceCount: 1,
  sourceTurnId: "turn-id",
  sourceRelationId: "relation-id",
  isActive: true,
  supersededByRelationId: null,
  recommendedAction: "完成纠正练习。",
  source: "learner-graph",
};

const evidence: EvidenceInsight = {
  id: "evidence-id",
  evidenceType: "EXPLANATION",
  evidenceForm: "解释",
  cognitiveLevel: 3,
  overallScore: null,
  dimensions: [],
  confidence: 0.85,
  answerSummary: null,
  graderExplanation: "回答包含核心理由。",
  sessionId: "session-id",
  turnId: "turn-id",
  createdAt: "2026-08-05T08:00:00Z",
  isUsedForCurrentMastery: true,
};

describe("learning insight panels", () => {
  it("renders missing grader dimensions without crashing", () => {
    render(<EvidencePanel target={target} items={[evidence]} state={panelState()} />);
    expect(screen.getByText("评分维度由后端未提供")).toBeInTheDocument();
    expect(screen.getByText("回答摘要：后端未提供")).toBeInTheDocument();
    const details = screen.getByRole("button", { name: "查看评分与来源" });
    expect(details).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(details);
    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/用于当前掌握判断：/)).toBeInTheDocument();
  });

  it("keeps prerequisites and misconceptions usable when evidence fails", () => {
    render(
      <div>
        <PrerequisitePanel
          target={target}
          items={[prerequisite]}
          structureSource="domain-detail"
          state={panelState()}
          onStart={vi.fn()}
        />
        <MisconceptionPanel
          target={target}
          groups={{ current: [misconception], history: [] }}
          state={panelState()}
        />
        <EvidencePanel
          target={target}
          items={[]}
          state={panelState({ error: new Error("Evidence unavailable") })}
        />
      </div>,
    );
    expect(screen.getByText("条件概率")).toBeInTheDocument();
    expect(screen.getByText("把后验概率当成先验概率")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("请求失败");
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("keeps historical misconceptions collapsed until requested", () => {
    const historical = {
      ...misconception,
      id: "historical-id",
      description: "已经纠正的误解",
      status: "resolved" as const,
      statusLabel: "已解决",
      isActive: false,
    };
    render(
      <MisconceptionPanel
        target={target}
        groups={{ current: [misconception], history: [historical] }}
        state={panelState()}
      />,
    );
    expect(screen.queryByText("已经纠正的误解")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "历史误解（1）" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("已经纠正的误解")).toBeInTheDocument();
  });

  it("opens the responsive learning-status dialog and exposes keyboard tabs", () => {
    const result: UseLearningInsightsResult = {
      insights: {
        targetKnowledgePoint: target,
        prerequisites: [prerequisite],
        prerequisiteStructureSource: "domain-detail",
        misconceptions: { current: [misconception], history: [] },
        evidence: [evidence],
        lastUpdatedAt: "2026-08-05T08:00:00Z",
        isRefreshing: false,
        partialErrors: {},
      },
      panels: {
        prerequisites: panelState(),
        misconceptions: panelState(),
        evidence: panelState(),
      },
    };
    render(
      <LearningStatusSheet
        open
        onOpenChange={vi.fn()}
        result={result}
        onStartPrerequisite={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("学习状态")).toBeInTheDocument();
    const evidenceTab = within(dialog).getByRole("tab", { name: "掌握证据" });
    evidenceTab.focus();
    expect(evidenceTab).toHaveFocus();
    fireEvent.click(evidenceTab);
    expect(evidenceTab).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByText("解释")).toBeInTheDocument();
  });
});
