import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { AppProvider } from "@/stores/AppContext";
import { api } from "@/services/api";
import { InitPage } from "./InitPage";

vi.mock("@/services/api", () => ({
  api: {
    createWorkspace: vi.fn(),
    createLearner: vi.fn(),
    getWorkspace: vi.fn(),
    getLearner: vi.fn(),
    listWorkspaces: vi.fn(),
    listLearners: vi.fn(),
  },
}));

const discoveredWorkspace = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "数据结构",
  slug: "data-structures",
  default_language: "zh-CN",
  created_at: "2026-08-05T00:00:00Z",
};

const discoveredLearner = {
  id: "22222222-2222-4222-8222-222222222222",
  workspace_id: discoveredWorkspace.id,
  display_name: "小林",
  language: "zh-CN",
  created_at: "2026-08-05T00:00:00Z",
};

afterEach(cleanup);

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AppProvider>
        <MemoryRouter initialEntries={["/init"]}>
          <Routes>
            <Route path="/init" element={<InitPage />} />
            <Route path="/overview" element={<p>Overview destination</p>} />
          </Routes>
        </MemoryRouter>
      </AppProvider>
    </QueryClientProvider>,
  );
}

describe("InitPage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    apiClient.setWorkspaceId(null);
    vi.clearAllMocks();
    vi.mocked(api.listWorkspaces).mockResolvedValue({
      items: [],
      limit: 100,
      offset: 0,
      next_offset: null,
    });
    vi.mocked(api.listLearners).mockResolvedValue({
      workspace_id: discoveredWorkspace.id,
      items: [],
      limit: 100,
      offset: 0,
      next_offset: null,
    });
  });

  it("announces setup as a focused main page", async () => {
    renderPage();

    const heading = screen.getByRole("heading", {
      name: "准备好你的专属学习助手",
    });
    expect(screen.getByRole("main")).toContainElement(heading);
    await waitFor(() => expect(heading).toHaveFocus());
    expect(document.title).toBe("设置学习 · KnowTier");
  });

  it("connects visible validation feedback to the topic input", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "保存主题，下一步" }));

    const error = await screen.findByText(/请输入学习主题/);
    const input = screen.getByLabelText("学习主题");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "workspace-name-error");
    expect(error).toHaveAttribute("id", "workspace-name-error");
    expect(error).toHaveAttribute("role", "alert");
  });

  it("creates a workspace then a learner through real service methods", async () => {
    vi.mocked(api.createWorkspace).mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Test Space",
      slug: "test-space",
      default_language: "zh-CN",
      created_at: "2026-08-05T00:00:00Z",
    });
    vi.mocked(api.createLearner).mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      workspace_id: "11111111-1111-4111-8111-111111111111",
      display_name: "测试学习者",
      language: "zh-CN",
      created_at: "2026-08-05T00:00:00Z",
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("学习主题"), {
      target: { value: "Test Space" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存主题，下一步" }));
    expect(await screen.findByText("我们怎么称呼你？")).toBeInTheDocument();
    expect(apiClient.getWorkspaceId()).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    fireEvent.change(screen.getByLabelText("希望怎样称呼你"), {
      target: { value: "测试学习者" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成设置，开始使用" }));
    expect(api.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "test-space" }),
    );
    await waitFor(() =>
      expect(api.createLearner).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace_id: "11111111-1111-4111-8111-111111111111",
          display_name: "测试学习者",
        }),
      ),
    );
    expect(await screen.findByText("Overview destination")).toBeVisible();
  });

  it("rejects an invalid manually entered workspace id", async () => {
    renderPage();
    fireEvent.click(
      screen.getByText("已有学习空间或管理员给了我一个标识"),
    );
    fireEvent.change(screen.getByLabelText("已有学习空间标识"), {
      target: { value: "not-a-uuid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "连接" }));
    expect(
      await screen.findByText("请输入有效的学习空间标识。"),
    ).toBeInTheDocument();
  });

  it("generates a stable safe identifier for a Chinese workspace name", async () => {
    vi.mocked(api.createWorkspace).mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      name: "产品体验验收",
      slug: "study-example",
      default_language: "zh-CN",
      created_at: "2026-08-05T00:00:00Z",
    });
    renderPage();

    fireEvent.change(screen.getAllByLabelText("学习主题").at(-1)!, {
      target: { value: "产品体验验收" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "保存主题，下一步" }).at(-1)!,
    );

    await waitFor(() =>
      expect(api.createWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({ slug: expect.stringMatching(/^study-[a-z0-9]+$/) }),
      ),
    );
  });

  it("carries the selected learning language into a new profile", async () => {
    vi.mocked(api.createWorkspace).mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      name: "English course",
      slug: "english-course",
      default_language: "en",
      created_at: "2026-08-05T00:00:00Z",
    });
    renderPage();

    fireEvent.change(screen.getByLabelText("学习主题"), {
      target: { value: "English course" },
    });
    fireEvent.change(screen.getByLabelText("默认学习语言"), {
      target: { value: "en" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存主题，下一步" }));

    expect(
      await screen.findByLabelText<HTMLSelectElement>("学习语言"),
    ).toHaveValue("en");
  });

  it("continues a persisted topic and profile by name after local history is cleared", async () => {
    vi.mocked(api.listWorkspaces).mockResolvedValue({
      items: [discoveredWorkspace],
      limit: 100,
      offset: 0,
      next_offset: null,
    });
    vi.mocked(api.listLearners).mockResolvedValue({
      workspace_id: discoveredWorkspace.id,
      items: [discoveredLearner],
      limit: 100,
      offset: 0,
      next_offset: null,
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "数据结构" }));
    fireEvent.click(await screen.findByRole("button", { name: "小林" }));

    expect(await screen.findByText("Overview destination")).toBeVisible();
    expect(api.getWorkspace).not.toHaveBeenCalled();
    expect(api.getLearner).not.toHaveBeenCalled();
  });

  it("offers a direct way to continue the current learning context", async () => {
    localStorage.setItem(
      "knowtier.app-state.v1",
      JSON.stringify({
        version: 1,
        currentWorkspace: discoveredWorkspace,
        currentLearner: discoveredLearner,
        currentDocumentId: null,
        sessionId: "44444444-4444-4444-8444-444444444444",
        recentWorkspaces: [discoveredWorkspace],
        recentLearners: [discoveredLearner],
        recentDocuments: [],
        preferences: {},
      }),
    );
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /继续当前学习/ }),
    );
    expect(await screen.findByText("Overview destination")).toBeVisible();
  });

  it("does not present a failed topic lookup as an empty saved list", async () => {
    vi.mocked(api.listWorkspaces)
      .mockRejectedValueOnce(new Error("lookup unavailable"))
      .mockResolvedValueOnce({
        items: [discoveredWorkspace],
        limit: 100,
        offset: 0,
        next_offset: null,
      });
    renderPage();

    expect(
      await screen.findByText(/暂时无法查找已保存主题/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重试查找" }));

    expect(
      await screen.findByRole("button", { name: "数据结构" }),
    ).toBeVisible();
  });

  it("explains how to recover when an automatically generated identifier conflicts", async () => {
    vi.mocked(api.createWorkspace).mockRejectedValue(
      new ApiError({
        message: "conflict",
        status: 409,
        kind: "conflict",
      }),
    );
    renderPage();
    fireEvent.change(screen.getByLabelText("学习主题"), {
      target: { value: "数据结构" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存主题，下一步" }));

    expect(
      await screen.findByText(/这个主题标识已经被使用/),
    ).toBeVisible();
    expect(screen.getByText("高级设置（通常无需修改）")).toBeVisible();
  });

  it("can discover topics beyond the first bounded page", async () => {
    const olderWorkspace = {
      ...discoveredWorkspace,
      id: "55555555-5555-4555-8555-555555555555",
      name: "较早的学习主题",
      slug: "older-topic",
    };
    vi.mocked(api.listWorkspaces).mockImplementation((_signal, offset = 0) =>
      Promise.resolve(
        offset === 0
          ? {
              items: [discoveredWorkspace],
              limit: 100,
              offset: 0,
              next_offset: 100,
            }
          : {
              items: [olderWorkspace],
              limit: 100,
              offset,
              next_offset: null,
            },
      ),
    );
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "加载更早的主题" }),
    );

    expect(
      await screen.findByRole("button", { name: "较早的学习主题" }),
    ).toBeVisible();
    expect(api.listWorkspaces).toHaveBeenLastCalledWith(
      expect.any(AbortSignal),
      100,
    );
  });
});
