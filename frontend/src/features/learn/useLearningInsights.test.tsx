import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import type { ChatResponse, GraphDetailResponse } from "@/types/api";
import { useLearningInsights } from "./useLearningInsights";

vi.mock("@/services/api", () => ({
  api: {
    getLearnerModel: vi.fn(),
    getLearnerEvidence: vi.fn(),
    getLearnerGraph: vi.fn(),
    getDomainDetail: vi.fn(),
  },
}));

const workspaceId = "workspace-id";
const learnerId = "learner-id";

function chatTarget(id: string, name: string): ChatResponse {
  return {
    target_knowledge_point: { id, name },
  } as ChatResponse;
}

function domainDetail(id: string, prerequisiteId: string): GraphDetailResponse {
  return {
    data: {
      node: { id, display_name: id },
      prerequisites: [{ id: prerequisiteId, display_name: prerequisiteId }],
    },
  };
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function installSuccessfulDefaults() {
  vi.mocked(api.getLearnerModel).mockResolvedValue({
    learner_id: learnerId,
    workspace_id: workspaceId,
    items: [],
  });
  vi.mocked(api.getLearnerEvidence).mockResolvedValue({
    learner_id: learnerId,
    items: [],
  });
  vi.mocked(api.getLearnerGraph).mockResolvedValue({
    elements: { nodes: [], edges: [] },
    meta: {},
  });
  vi.mocked(api.getDomainDetail).mockImplementation(
    (_workspace, targetId) =>
      Promise.resolve(domainDetail(targetId, `prerequisite-${targetId}`)),
  );
}

describe("useLearningInsights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installSuccessfulDefaults();
  });

  it("does not call detail APIs when the current target has no valid id", () => {
    renderHook(
      () =>
        useLearningInsights({
          workspaceId,
          learnerId,
          latestChatResponse: null,
          navigationTarget: { name: "只有名称" },
        }),
      { wrapper: createWrapper() },
    );
    expect(api.getLearnerModel).not.toHaveBeenCalled();
    expect(api.getLearnerEvidence).not.toHaveBeenCalled();
    expect(api.getLearnerGraph).not.toHaveBeenCalled();
    expect(api.getDomainDetail).not.toHaveBeenCalled();
  });

  it("queries the latest chat target instead of the navigation target", async () => {
    const { result } = renderHook(
      () =>
        useLearningInsights({
          workspaceId,
          learnerId,
          latestChatResponse: chatTarget("chat-id", "聊天目标"),
          navigationTarget: { id: "navigation-id", name: "导航目标" },
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() =>
      expect(api.getDomainDetail).toHaveBeenCalledWith(
        workspaceId,
        "chat-id",
        expect.any(AbortSignal),
      ),
    );
    expect(result.current.insights.targetKnowledgePoint).toMatchObject({
      id: "chat-id",
      source: "chat",
    });
  });

  it("never lets a superseded target request overwrite the new target", async () => {
    let resolveOld: ((value: GraphDetailResponse) => void) | undefined;
    vi.mocked(api.getDomainDetail).mockImplementation(
      (_workspace, targetId) => {
        if (targetId === "old-id") {
          return new Promise((resolve) => {
            resolveOld = resolve;
          });
        }
        return Promise.resolve(domainDetail("new-id", "new-prerequisite"));
      },
    );
    const { result, rerender } = renderHook(
      ({ response }: { response: ChatResponse }) =>
        useLearningInsights({
          workspaceId,
          learnerId,
          latestChatResponse: response,
          navigationTarget: null,
        }),
      {
        initialProps: { response: chatTarget("old-id", "旧目标") },
        wrapper: createWrapper(),
      },
    );
    await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    rerender({ response: chatTarget("new-id", "新目标") });
    expect(result.current.insights.targetKnowledgePoint?.id).toBe("new-id");
    expect(result.current.insights.prerequisites).toEqual([]);
    await waitFor(() =>
      expect(result.current.insights.prerequisites[0]?.id).toBe("new-prerequisite"),
    );
    resolveOld?.(domainDetail("old-id", "old-prerequisite"));
    await waitFor(() =>
      expect(result.current.insights.prerequisites[0]?.id).toBe("new-prerequisite"),
    );
    expect(result.current.insights.prerequisites).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "old-prerequisite" })]),
    );
  });

  it("isolates an evidence failure from prerequisite and misconception data", async () => {
    vi.mocked(api.getLearnerEvidence).mockRejectedValue(new Error("evidence failed"));
    vi.mocked(api.getLearnerModel).mockResolvedValue({
      learner_id: learnerId,
      workspace_id: workspaceId,
      items: [
        {
          knowledge_point_id: "target-id",
          knowledge_point: "目标",
          current_level: 2,
          mastery_score: 0.5,
          confidence: 0.7,
          evidence_count: 0,
          critical_misconceptions: ["真实误解"],
          prerequisites: [],
          all_prerequisites_mastered: true,
          prerequisite_status: "none",
          last_interaction_at: null,
          next_review_at: null,
          recommended_action: "REQUEST_MORE_EVIDENCE",
        },
      ],
    });
    const { result } = renderHook(
      () =>
        useLearningInsights({
          workspaceId,
          learnerId,
          latestChatResponse: chatTarget("target-id", "目标"),
          navigationTarget: null,
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.panels.evidence.error).toBeInstanceOf(Error));
    expect(result.current.panels.prerequisites.error).toBeNull();
    expect(result.current.panels.misconceptions.error).toBeNull();
    expect(result.current.insights.misconceptions.current[0]?.description).toBe("真实误解");
  });
});
