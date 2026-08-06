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
import type { ModelProfile } from "@/types/api";

vi.mock("@/services/api", () => ({
  api: {
    health: vi.fn(),
    readiness: vi.fn(),
    getModelConfiguration: vi.fn(),
    createModelProfile: vi.fn(),
    updateModelProfile: vi.fn(),
    activateModelProfile: vi.fn(),
    discoverProviderModels: vi.fn(),
    testModelConnection: vi.fn(),
    deleteModelCredential: vi.fn(),
    deleteModelProfile: vi.fn(),
  },
}));

const mockProfile: ModelProfile = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Mock Provider",
  provider: "mock",
  base_url: null,
  allow_local: false,
  credential_storage: "session",
  models: {
    teacher: "mock/default",
    extractor: "mock/default",
    grader: "mock/default",
    graph: "mock/default",
    vision: "mock/default",
    embedding: "mock/default",
  },
  timeout_seconds: 30,
  max_retries: 0,
  temperature: 0,
  max_tokens: 2048,
  active: true,
  connection_status: "connected",
  last_tested_at: "2026-08-06T00:00:00Z",
  error_summary: null,
  updated_at: "2026-08-06T00:00:00Z",
  credential_present: true,
  credential_masked: null,
};

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
    vi.mocked(api.getModelConfiguration).mockResolvedValue({
      profiles: [mockProfile],
      active_profile_id: mockProfile.id,
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

  it("keeps a supplied model credential out of localStorage", async () => {
    const siliconFlow: ModelProfile = {
      ...mockProfile,
      id: "22222222-2222-4222-8222-222222222222",
      name: "SiliconFlow",
      provider: "siliconflow",
      base_url: "https://api.siliconflow.cn/v1",
      active: false,
      credential_present: true,
      credential_masked: "••••••••",
      connection_status: "untested",
    };
    vi.mocked(api.createModelProfile).mockResolvedValue(siliconFlow);
    renderPage();

    expect(await screen.findByText("模型与供应商")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "新建配置" }));
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "never-persist-this-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() =>
      expect(api.createModelProfile).toHaveBeenCalledWith(
        expect.objectContaining({ api_key: "never-persist-this-key" }),
      ),
    );
    expect(localStorage.getItem("knowtier.app-state.v1")).not.toContain(
      "never-persist-this-key",
    );
  });
});
