import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "@/stores/AppContext";
import { api } from "@/services/api";
import { InitPage } from "./InitPage";

vi.mock("@/services/api", () => ({
  api: {
    createWorkspace: vi.fn(),
    createLearner: vi.fn(),
    getLearner: vi.fn(),
  },
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AppProvider>
        <MemoryRouter>
          <InitPage />
        </MemoryRouter>
      </AppProvider>
    </QueryClientProvider>,
  );
}

describe("InitPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
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
    fireEvent.change(screen.getByPlaceholderText("例如：机器学习基础"), {
      target: { value: "Test Space" },
    });
    fireEvent.change(screen.getByPlaceholderText("machine-learning"), {
      target: { value: "test-space" },
    });
    fireEvent.click(screen.getByRole("button", { name: /创建 Workspace/ }));
    expect(await screen.findByText("学习者")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("例如：林同学"), {
      target: { value: "测试学习者" },
    });
    fireEvent.click(screen.getByRole("button", { name: /创建并进入总览/ }));
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
  });

  it("rejects an invalid manually entered workspace id", async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText("Workspace UUID"), {
      target: { value: "not-a-uuid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "连接" }));
    expect(
      await screen.findByText("请输入有效的 Workspace UUID。"),
    ).toBeInTheDocument();
  });
});
