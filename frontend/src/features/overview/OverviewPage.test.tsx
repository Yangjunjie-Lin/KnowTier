import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { api } from "@/services/api";
import { OverviewPage } from "./OverviewPage";

const { clearLocalHistory } = vi.hoisted(() => ({
  clearLocalHistory: vi.fn(),
}));

vi.mock("@/stores/AppContext", () => ({
  useAppStore: () => ({
    currentWorkspace: { id: "workspace-1", name: "测试空间" },
    currentLearner: { id: "learner-1", display_name: "测试学习者" },
    recentDocuments: [],
    clearLocalHistory,
    preferences: { uiLocale: "zh-CN" },
    setUiLocale: vi.fn(),
  }),
  useOptionalAppStore: () => ({
    preferences: { uiLocale: "zh-CN" },
    setUiLocale: vi.fn(),
  }),
}));

vi.mock("@/services/api", () => ({
  api: {
    getManifest: vi.fn(),
    getLearnerModel: vi.fn(),
    getLearnerEvidence: vi.fn(),
    listLearnerRevisions: vi.fn(),
    listDomainRevisions: vi.fn(),
  },
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OverviewPage recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const missing = new ApiError({
      message: "学习空间不存在",
      status: 404,
      kind: "not_found",
    });
    vi.mocked(api.getManifest).mockRejectedValue(missing);
    vi.mocked(api.getLearnerModel).mockRejectedValue(missing);
    vi.mocked(api.getLearnerEvidence).mockResolvedValue({
      learner_id: "learner-1",
      items: [],
    });
    vi.mocked(api.listLearnerRevisions).mockResolvedValue({
      learner_id: "learner-1",
      items: [],
    });
    vi.mocked(api.listDomainRevisions).mockResolvedValue({
      workspace_id: "workspace-1",
      items: [],
    });
  });

  it("offers to clear stale local context after a 404", async () => {
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "重新初始化" }),
    );
    expect(clearLocalHistory).toHaveBeenCalledOnce();
  });

  it("replaces zero-value analytics with two clear first-step choices", async () => {
    vi.mocked(api.getManifest).mockResolvedValue({
      workspace_id: "workspace-1",
      graph_revision_id: null,
      data: {
        workspace_id: "workspace-1",
        revision_id: null,
        ontology: { entity_types: [], relation_types: [] },
        top_level_domains: [],
        theories: [],
        knowledge_point_count: 0,
        assertion_count: 0,
        source_count: 0,
        major_clusters: [],
      },
    });
    vi.mocked(api.getLearnerModel).mockResolvedValue({
      learner_id: "learner-1",
      workspace_id: "workspace-1",
      items: [],
    });

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "选择最适合你的开始方式" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /直接问第一个问题/ }),
    ).toHaveAttribute("href", "/learn");
    expect(
      screen.getByRole("link", { name: /先添加一份学习资料/ }),
    ).toHaveAttribute("href", "/materials");
    expect(screen.queryByText("领域知识点")).not.toBeInTheDocument();
  });

  it("treats a profile as new even when the shared topic already has knowledge", async () => {
    vi.mocked(api.getManifest).mockResolvedValue({
      workspace_id: "workspace-1",
      graph_revision_id: "revision-1",
      data: {
        workspace_id: "workspace-1",
        revision_id: "revision-1",
        ontology: { entity_types: [], relation_types: [] },
        top_level_domains: [],
        theories: [],
        knowledge_point_count: 12,
        assertion_count: 18,
        source_count: 1,
        major_clusters: [],
      },
    });
    vi.mocked(api.getLearnerModel).mockResolvedValue({
      learner_id: "learner-1",
      workspace_id: "workspace-1",
      items: [],
    });

    renderPage();

    expect(
      await screen.findByRole("heading", {
        name: "选择最适合你的开始方式",
      }),
    ).toBeVisible();
    expect(
      screen.getByText("你的学习档案已经准备好。选择一种方式，开始第一次学习。"),
    ).toBeVisible();
  });
});
