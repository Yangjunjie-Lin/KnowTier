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
});
