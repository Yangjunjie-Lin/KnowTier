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
    expect(
      await screen.findByRole("button", { name: "浅色" }),
    ).toHaveAttribute("aria-pressed", "true");
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

  it("switches the interface between Chinese and English and persists it", async () => {
    renderPage();
    const language = await screen.findByLabelText("界面语言");
    fireEvent.change(language, { target: { value: "en" } });

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeVisible();
    expect(screen.getByText("Learning preferences")).toBeVisible();
    expect(document.documentElement.lang).toBe("en");
    await waitFor(() =>
      expect(localStorage.getItem("knowtier.app-state.v1")).toContain(
        '"uiLocale":"en"',
      ),
    );
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
    const apiKeyInput = screen.getByLabelText("API Key");
    expect(apiKeyInput).toHaveAttribute("type", "password");
    fireEvent.change(apiKeyInput, {
      target: { value: "never-persist-this-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "显示密钥内容" }));
    expect(apiKeyInput).toHaveAttribute("type", "text");
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

  it("preserves a custom profile name when the provider changes", async () => {
    renderPage();
    const name = await screen.findByLabelText("配置名称");
    const provider = screen.getByLabelText("供应商");

    // The selected profile and its editable form must be hydrated atomically.
    // Exposing the default new-profile form here lets a fast edit be overwritten
    // by the selected profile's hydration effect.
    expect(name).toHaveValue("Mock Provider");
    expect(provider).toHaveValue("mock");
    fireEvent.change(name, { target: { value: "课程专用模型" } });

    fireEvent.change(provider, {
      target: { value: "custom_openai_compatible" },
    });

    expect(name).toHaveValue("课程专用模型");
  });

  it("keeps embedding separate from the unified generation model", async () => {
    const siliconFlow: ModelProfile = {
      ...mockProfile,
      id: "22222222-2222-4222-8222-222222222222",
      name: "SiliconFlow",
      provider: "siliconflow",
      base_url: "https://api.siliconflow.cn/v1",
      models: {
        teacher: "Qwen/Qwen2.5-7B-Instruct",
        extractor: "Qwen/Qwen2.5-7B-Instruct",
        grader: "Qwen/Qwen2.5-7B-Instruct",
        graph: "Qwen/Qwen2.5-7B-Instruct",
        vision: "Qwen/Qwen2.5-7B-Instruct",
        embedding: "Qwen/Qwen2.5-7B-Instruct",
      },
      credential_present: true,
      credential_masked: "••••••••",
    };
    vi.mocked(api.getModelConfiguration).mockResolvedValue({
      profiles: [siliconFlow],
      active_profile_id: siliconFlow.id,
    });
    vi.mocked(api.updateModelProfile).mockImplementation((_id, input) =>
      Promise.resolve({
        ...siliconFlow,
        models: input.models,
      }),
    );
    vi.mocked(api.discoverProviderModels).mockResolvedValue({
      profile_id: siliconFlow.id,
      provider: "siliconflow",
      models: [
        "Qwen/Qwen2.5-7B-Instruct",
        "BAAI/bge-reranker-v2-m3",
        "Qwen/Qwen3-Embedding-0.6B",
        "BAAI/bge-m3",
      ],
      tested_at: "2026-08-08T00:00:00Z",
    });

    renderPage();
    const generation = await screen.findByLabelText(/统一生成模型/);
    const embedding = screen.getByLabelText(/^向量模型/);
    await waitFor(() => {
      expect(generation).toHaveValue("Qwen/Qwen2.5-7B-Instruct");
      expect(embedding).toHaveValue("Qwen/Qwen2.5-7B-Instruct");
    });

    fireEvent.click(screen.getByRole("button", { name: "刷新模型" }));
    await waitFor(() =>
      expect(embedding).toHaveValue("Qwen/Qwen3-Embedding-0.6B"),
    );

    fireEvent.change(generation, { target: { value: "provider/next-chat" } });
    expect(embedding).toHaveValue("Qwen/Qwen3-Embedding-0.6B");
  });

  it("runs an explicit offline connection test for the Mock provider", async () => {
    vi.mocked(api.updateModelProfile).mockResolvedValue(mockProfile);
    vi.mocked(api.testModelConnection).mockResolvedValue({
      profile_id: mockProfile.id,
      provider: "mock",
      models: ["mock/default"],
      tested_at: "2026-08-09T00:00:00Z",
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByLabelText("配置名称")).toHaveValue("Mock Provider"),
    );
    fireEvent.click(await screen.findByRole("button", { name: "测试连接" }));

    await waitFor(() =>
      expect(api.testModelConnection).toHaveBeenCalledWith(mockProfile.id),
    );
    expect(
      await screen.findByText("连接测试成功，供应商返回 1 个模型。"),
    ).toBeVisible();
  });

  it("explains required SiliconFlow setup before sending a connection test", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "新建配置" }));
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

    expect(
      await screen.findByText("请先输入 API Key，再刷新模型或测试连接。"),
    ).toBeVisible();
    expect(api.createModelProfile).not.toHaveBeenCalled();
    expect(api.testModelConnection).not.toHaveBeenCalled();
  });
});
