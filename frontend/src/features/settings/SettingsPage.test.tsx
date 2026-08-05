import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { AppProvider } from "@/stores/AppContext";
import { SettingsPage } from "./SettingsPage";

vi.mock("@/services/api", () => ({
  api: {
    health: vi.fn(),
    readiness: vi.fn(),
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
          <SettingsPage />
        </MemoryRouter>
      </AppProvider>
    </QueryClientProvider>,
  );
}

describe("SettingsPage learning preferences", () => {
  afterEach(cleanup);

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(api.health).mockResolvedValue({ status: "ok" });
    vi.mocked(api.readiness).mockResolvedValue({
      status: "ok",
      postgres: true,
      neo4j: true,
    });
  });

  it("persists local teaching preferences and applies font size", async () => {
    const view = renderPage();
    fireEvent.change(screen.getByLabelText("默认教学模式"), {
      target: { value: "research" },
    });
    fireEvent.change(screen.getByLabelText("解释详细程度"), {
      target: { value: "detailed" },
    });
    fireEvent.change(screen.getByLabelText("字体大小"), {
      target: { value: "large" },
    });
    fireEvent.change(screen.getByLabelText("图谱标签显示密度"), {
      target: { value: "minimal" },
    });

    await waitFor(() => {
      const raw = localStorage.getItem("knowtier.app-state.v1");
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw ?? "{}") as {
        preferences?: Record<string, unknown>;
      };
      expect(parsed.preferences).toMatchObject({
        defaultTeachingMode: "research",
        explanationDetail: "detailed",
        fontSize: "large",
        graphLabelDensity: "minimal",
      });
    });
    expect(document.documentElement.dataset.fontSize).toBe("large");

    view.unmount();
    renderPage();
    expect(screen.getByLabelText("默认教学模式")).toHaveValue("research");
    expect(screen.getByLabelText("解释详细程度")).toHaveValue("detailed");
    expect(screen.getByLabelText("字体大小")).toHaveValue("large");
  });

  it("migrates older local state with safe defaults", () => {
    localStorage.setItem(
      "knowtier.app-state.v1",
      JSON.stringify({
        version: 1,
        sessionId: "99999999-9999-4999-8999-999999999999",
        preferences: { apiBaseUrl: "/api", hintStrength: "not-real" },
      }),
    );
    renderPage();
    expect(screen.getByLabelText("默认教学模式")).toHaveValue("learn");
    expect(screen.getByLabelText("提示强度")).toHaveValue("balanced");
  });
});
