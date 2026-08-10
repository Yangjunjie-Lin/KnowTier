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
import { AppProvider, useAppStore } from "@/stores/AppContext";
import { api } from "@/services/api";
import type {
  ChatResponse,
  DocumentRecord,
  IngestionReport,
} from "@/types/api";
import {
  LearnPage,
  TeachingTurn,
  learningTargetDraft,
  learningTargetFromState,
} from "./LearnPage";

vi.mock("@/services/api", () => ({
  api: {
    chat: vi.fn(),
    uploadDocument: vi.fn(),
    ingestDocument: vi.fn(),
    getLearnerModel: vi.fn(),
    getLearnerEvidence: vi.fn(),
    getLearnerGraph: vi.fn(),
    getDomainDetail: vi.fn(),
    getActiveModel: vi.fn(),
  },
}));

const workspace = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "测试空间",
  slug: "test-space",
  default_language: "zh-CN",
  created_at: "2026-08-05T00:00:00Z",
};

const learner = {
  id: "22222222-2222-4222-8222-222222222222",
  workspace_id: workspace.id,
  display_name: "测试学习者",
  language: "zh-CN",
  created_at: "2026-08-05T00:00:00Z",
};

const uploadedDocument: DocumentRecord = {
  id: "33333333-3333-4333-8333-333333333333",
  workspace_id: workspace.id,
  filename: "lesson.txt",
  mime_type: "text/plain",
  byte_size: 12,
  sha256: "a".repeat(64),
  status: "UPLOADED",
  page_count: null,
  warnings: [],
  created_at: "2026-08-05T00:00:00Z",
};

const ingestionReport: IngestionReport = {
  document_id: uploadedDocument.id,
  parser: "plain-text",
  page_count: 1,
  chunk_count: 1,
  knowledge_point_count: 1,
  assertion_count: 1,
  warning_count: 0,
  graph_revision_id: "44444444-4444-4444-8444-444444444444",
  parser_chain: ["plain-text"],
  ocr_used: false,
  vision_used: false,
  detected_language: "zh-CN",
  low_confidence_blocks: 0,
};

const chatResponse: ChatResponse = {
  turn_id: "55555555-5555-4555-8555-555555555555",
  response: "这是教师讲解。",
  target_knowledge_point: {
    id: "66666666-6666-4666-8666-666666666666",
    name: "梯度下降",
  },
  cognitive_level: 2,
  teaching_action: "DEMONSTRATE",
  assessment: { type: "REPRODUCE_PROCEDURE", question: "下一步是什么？" },
  learner_update: {
    decision: "REQUEST_MORE_EVIDENCE",
    reason: "还需要一次独立回答。",
    current_level: 2,
    mastery_score: 0.56,
    confidence: 0.7,
  },
  graph_update: {
    revision_id: null,
    nodes_added: 0,
    assertions_added: 0,
    assertions_superseded: 0,
  },
  learner_graph_update: null,
  tool_usage: null,
  sources: [],
};

function persistedState() {
  return {
    version: 1,
    currentWorkspace: workspace,
    currentLearner: learner,
    currentDocumentId: null,
    sessionId: "77777777-7777-4777-8777-777777777777",
    recentWorkspaces: [workspace],
    recentLearners: [learner],
    recentDocuments: [],
    preferences: {
      apiBaseUrl: "/api",
      uiLocale: "zh-CN",
      theme: "light",
      reducedMotion: false,
      graphDensity: "comfortable",
      defaultTeachingMode: "practice",
      explanationDetail: "balanced",
      prioritizeExamples: true,
      hintStrength: "balanced",
      reviewFrequency: "twice-weekly",
      fontSize: "medium",
      graphLabelDensity: "balanced",
    },
  };
}

function TestLocaleSwitch() {
  const { setUiLocale } = useAppStore();
  return (
    <button type="button" onClick={() => setUiLocale("en")}>
      test-switch-language
    </button>
  );
}

function renderPage(state?: unknown, includeLocaleSwitch = false) {
  localStorage.setItem(
    "knowtier.app-state.v1",
    JSON.stringify(persistedState()),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AppProvider>
        <MemoryRouter initialEntries={[{ pathname: "/learn", state }]}>
          {includeLocaleSwitch && <TestLocaleSwitch />}
          <LearnPage />
        </MemoryRouter>
      </AppProvider>
    </QueryClientProvider>,
  );
}

describe("LearnPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getLearnerModel).mockResolvedValue({
      learner_id: learner.id,
      workspace_id: workspace.id,
      items: [],
    });
    vi.mocked(api.getLearnerEvidence).mockResolvedValue({
      learner_id: learner.id,
      items: [],
    });
    vi.mocked(api.getLearnerGraph).mockResolvedValue({
      elements: { nodes: [], edges: [] },
      meta: {},
    });
    vi.mocked(api.getDomainDetail).mockResolvedValue({
      data: { prerequisites: [] },
    });
    vi.mocked(api.getActiveModel).mockResolvedValue({
      role: "teacher",
      provider: "mock",
      model: "mock/default",
      profile_id: null,
      profile_name: "Mock Provider",
    });
  });

  it("reads a tolerant navigation target and only prefills its confirmation", () => {
    const target = learningTargetFromState({
      learningTarget: {
        name: "  反向传播  ",
        id: "88888888-8888-4888-8888-888888888888",
        source: "domain-graph",
        future_field: { safe: true },
      },
    });
    expect(target).toEqual({
      name: "反向传播",
      id: "88888888-8888-4888-8888-888888888888",
      source: "domain-graph",
    });
    expect(learningTargetDraft(target)).toContain("请先和我确认学习目标");
    renderPage({ learningTarget: target });
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("学习消息").value,
    ).toContain("反向传播");
    expect(api.chat).not.toHaveBeenCalled();
    expect(screen.getByText("等待你确认")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "调整教学偏好" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.queryByText("本地教学偏好")).not.toBeInTheDocument();
    expect(screen.queryByText("会话状态")).not.toBeInTheDocument();
    expect(screen.queryByText("工具调用")).not.toBeInTheDocument();
    expect(screen.queryByText("图谱更新")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "给我一个提示" }));
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("学习消息").value,
    ).toContain("请给我一个分步骤提示");
    expect(api.chat).not.toHaveBeenCalled();
  });

  it("uploads, ingests and attaches a material without inventing an API", async () => {
    vi.mocked(api.uploadDocument).mockResolvedValue(uploadedDocument);
    vi.mocked(api.ingestDocument).mockResolvedValue(ingestionReport);
    vi.mocked(api.chat).mockResolvedValue(chatResponse);
    renderPage();

    const file = new File(["lesson text"], "lesson.txt", {
      type: "text/plain",
    });
    fireEvent.change(screen.getByLabelText("上传学习资料"), {
      target: { files: [file] },
    });

    expect(
      await screen.findByText("lesson.txt 已准备完成并加入本轮附件"),
    ).toBeInTheDocument();
    expect(api.uploadDocument).toHaveBeenCalledWith(workspace.id, file);
    expect(api.ingestDocument).toHaveBeenCalledWith(uploadedDocument.id);
    expect(screen.getByText("lesson.txt")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("学习消息"), {
      target: { value: "请讲解这份资料" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送学习消息" }));
    await waitFor(() =>
      expect(api.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          attachment_ids: [uploadedDocument.id],
          requested_mode: "practice",
        }),
        expect.any(AbortSignal),
      ),
    );
    expect(await screen.findByText("这是教师讲解。")).toBeInTheDocument();
    expect(screen.getByText(/唯一掌握检测.*复现步骤/)).toBeInTheDocument();
  });

  it("keeps the learner draft when ingestion fails", async () => {
    vi.mocked(api.uploadDocument).mockResolvedValue(uploadedDocument);
    vi.mocked(api.ingestDocument).mockRejectedValue(
      new Error("解析器暂时不可用"),
    );
    renderPage();
    fireEvent.change(screen.getByLabelText("学习消息"), {
      target: { value: "不要清空这段草稿" },
    });
    fireEvent.change(screen.getByLabelText("上传学习资料"), {
      target: {
        files: [new File(["x"], "broken.txt", { type: "text/plain" })],
      },
    });
    expect(
      await screen.findByText(/处理失败.*暂时无法处理这份资料/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("学习消息")).toHaveValue("不要清空这段草稿");
    expect(api.chat).not.toHaveBeenCalled();
  });

  it("retries ingestion without uploading the same file twice", async () => {
    vi.mocked(api.uploadDocument).mockResolvedValue(uploadedDocument);
    vi.mocked(api.ingestDocument)
      .mockRejectedValueOnce(new Error("摄取服务暂时不可用"))
      .mockResolvedValueOnce(ingestionReport);
    renderPage();

    const file = new File(["retry me"], "retry.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("上传学习资料"), {
      target: { files: [file] },
    });

    expect(
      await screen.findByText(/处理失败.*暂时无法处理这份资料/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(
      await screen.findByText("retry.txt 已准备完成并加入本轮附件"),
    ).toBeVisible();
    expect(api.uploadDocument).toHaveBeenCalledTimes(1);
    expect(api.ingestDocument).toHaveBeenCalledTimes(2);
    expect(api.ingestDocument).toHaveBeenNthCalledWith(2, uploadedDocument.id);
  });

  it("locks session and attachment controls while a turn is in flight", async () => {
    vi.mocked(api.chat).mockImplementation(
      () => new Promise<ChatResponse>(() => undefined),
    );
    renderPage();
    fireEvent.change(screen.getByLabelText("学习消息"), {
      target: { value: "等待这一轮完成" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送学习消息" }));

    await waitFor(() => expect(api.chat).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "新建会话" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /选择已有资料/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上传资料" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "拍照" })).toBeDisabled();
    expect(screen.getByLabelText("上传学习资料")).toBeDisabled();
    expect(screen.getByLabelText("拍照上传学习资料")).toBeDisabled();
  });

  it("synchronously blocks a duplicate submit before React rerenders", async () => {
    vi.mocked(api.chat).mockImplementation(
      () => new Promise<ChatResponse>(() => undefined),
    );
    renderPage();
    fireEvent.change(screen.getByLabelText("学习消息"), {
      target: { value: "只提交一次" },
    });
    const send = screen.getByRole("button", { name: "发送学习消息" });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(api.chat).toHaveBeenCalledOnce());
  });

  it("does not submit while an input method is composing text", () => {
    renderPage();
    const composer = screen.getByLabelText("学习消息");
    fireEvent.change(composer, { target: { value: "正在输入中文" } });
    fireEvent.keyDown(composer, {
      key: "Enter",
      code: "Enter",
      isComposing: true,
    });

    expect(api.chat).not.toHaveBeenCalled();
    expect(composer).toHaveValue("正在输入中文");
  });

  it("reuses one client request id when retrying a failed turn", async () => {
    vi.mocked(api.chat)
      .mockRejectedValueOnce(new Error("暂时无法完成教学请求"))
      .mockResolvedValueOnce(chatResponse);
    renderPage();
    fireEvent.change(screen.getByLabelText("学习消息"), {
      target: { value: "什么是 RAG" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送学习消息" }));

    fireEvent.click(await screen.findByRole("button", { name: "重试" }));
    await waitFor(() => expect(api.chat).toHaveBeenCalledTimes(2));

    const first = vi.mocked(api.chat).mock.calls[0]?.[0];
    const second = vi.mocked(api.chat).mock.calls[1]?.[0];
    expect(first?.client_request_id).toBeTruthy();
    expect(second?.client_request_id).toBe(first?.client_request_id);
  });

  it("cancels without losing the draft and retries the same request id", async () => {
    vi.mocked(api.chat)
      .mockImplementationOnce(
        (_input, signal) =>
          new Promise<ChatResponse>((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new DOMException("cancelled", "AbortError")),
              { once: true },
            );
          }),
      )
      .mockResolvedValueOnce(chatResponse);
    renderPage();
    fireEvent.change(screen.getByLabelText("学习消息"), {
      target: { value: "取消后保留我" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送学习消息" }));
    fireEvent.click(await screen.findByRole("button", { name: "取消" }));

    expect(await screen.findByText(/本轮请求已取消/)).toBeVisible();
    expect(screen.getByLabelText("学习消息")).toHaveValue("取消后保留我");
    expect(screen.getByLabelText("学习消息")).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "重试本轮" }));
    expect(await screen.findByText("这是教师讲解。")).toBeVisible();
    const first = vi.mocked(api.chat).mock.calls[0]?.[0];
    const second = vi.mocked(api.chat).mock.calls[1]?.[0];
    expect(second?.client_request_id).toBe(first?.client_request_id);
  });

  it("clears draft and mismatched state for a new session", async () => {
    renderPage({
      learningTarget: { name: "旧目标", source: "learning-path" },
    });
    fireEvent.change(screen.getByLabelText("学习消息"), {
      target: { value: "旧 Session 草稿" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    expect(screen.getByLabelText("学习消息")).toHaveValue("");
    await waitFor(() =>
      expect(screen.queryByText("旧目标")).not.toBeInTheDocument(),
    );
  });

  it("keeps the current draft when starting a new session is cancelled", () => {
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    renderPage();
    fireEvent.change(screen.getByLabelText("学习消息"), {
      target: { value: "还没有写完的草稿" },
    });

    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("学习消息")).toHaveValue("还没有写完的草稿");
  });

  it("refreshes model, evidence, learner graph, and domain detail after chat", async () => {
    vi.mocked(api.chat).mockResolvedValue(chatResponse);
    renderPage();
    fireEvent.change(screen.getByLabelText("学习消息"), {
      target: { value: "请检查我的理解" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送学习消息" }));
    await waitFor(() => expect(api.getLearnerModel).toHaveBeenCalled());
    expect(api.getLearnerEvidence).toHaveBeenCalled();
    expect(api.getLearnerGraph).toHaveBeenCalled();
    expect(api.getDomainDetail).toHaveBeenCalledWith(
      workspace.id,
      chatResponse.target_knowledge_point.id,
      expect.any(AbortSignal),
    );
  });

  it("shows an explicit synchronization state until chat-triggered reads settle", async () => {
    let resolveEvidence:
      ((value: { learner_id: string; items: [] }) => void) | undefined;
    vi.mocked(api.chat).mockResolvedValue(chatResponse);
    vi.mocked(api.getLearnerEvidence).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEvidence = resolve;
        }),
    );
    renderPage();
    fireEvent.change(screen.getByLabelText("学习消息"), {
      target: { value: "提交本轮答案" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送学习消息" }));
    expect(
      (await screen.findAllByText("正在更新学习记录…")).length,
    ).toBeGreaterThan(0);
    resolveEvidence?.({ learner_id: learner.id, items: [] });
    await waitFor(() =>
      expect(screen.queryByText("正在更新学习记录…")).not.toBeInTheDocument(),
    );
  });

  it("turns a prerequisite action into navigation state without changing the backend target", async () => {
    const prerequisiteId = "99999999-9999-4999-8999-999999999999";
    vi.mocked(api.getDomainDetail).mockImplementation((_workspaceId, nodeId) =>
      Promise.resolve({
        data: {
          prerequisites:
            nodeId === chatResponse.target_knowledge_point.id
              ? [{ id: prerequisiteId, display_name: "条件概率" }]
              : [],
        },
      }),
    );
    renderPage({
      learningTarget: {
        id: chatResponse.target_knowledge_point.id,
        name: "梯度下降",
        source: "domain-graph",
      },
    });
    expect(await screen.findByText("条件概率")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始学习" }));
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("学习消息").value,
    ).toContain("条件概率");
    expect(api.chat).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(api.getDomainDetail).toHaveBeenCalledWith(
        workspace.id,
        prerequisiteId,
        expect.any(AbortSignal),
      ),
    );
  });

  it("renders future response enums safely as product copy", () => {
    render(
      <AppProvider>
        <TeachingTurn
          result={{
            ...chatResponse,
            teaching_action: "FUTURE_SCAFFOLD",
            assessment: { type: "FUTURE_CHECK", question: "未来问题？" },
          }}
        />
      </AppProvider>,
    );
    expect(screen.getByText("其他教学动作")).toBeInTheDocument();
    expect(screen.getByText(/其他掌握检测/)).toBeInTheDocument();
    expect(screen.queryByText(/FUTURE_SCAFFOLD/)).not.toBeInTheDocument();
    expect(screen.queryByText(/FUTURE_CHECK/)).not.toBeInTheDocument();
  });

  it("renders structured Markdown and exposes copy controls", () => {
    render(
      <AppProvider>
        <TeachingTurn
          result={{
            ...chatResponse,
            response:
              "## 推导\n\n公式 $a^2+b^2=c^2$\n\n```python\nprint('ok')\n```",
          }}
        />
      </AppProvider>,
    );
    expect(screen.getByRole("heading", { name: "推导" })).toBeVisible();
    expect(screen.getByText("print('ok')")).toBeVisible();
    expect(screen.getByRole("button", { name: "复制代码" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "复制完整教学回答" }),
    ).toBeVisible();
  });

  it("switches learning controls and safe enum labels to English immediately", async () => {
    vi.mocked(api.chat).mockResolvedValue({
      ...chatResponse,
      teaching_action: "FUTURE_SCAFFOLD",
      assessment: { type: "FUTURE_CHECK", question: "A future check?" },
    });
    renderPage(undefined, true);

    expect(screen.getByRole("heading", { name: "学习空间" })).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "test-switch-language" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Learning" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Give me a hint" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Learning message")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Learning message"), {
      target: { value: "Explain RAG" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Send learning message" }),
    );

    expect(await screen.findByText("Other teaching action")).toBeVisible();
    expect(screen.getByText(/Other mastery check/)).toBeVisible();
    expect(
      screen.queryByText(/FUTURE_SCAFFOLD|FUTURE_CHECK/),
    ).not.toBeInTheDocument();
  });

  it("keeps backend identifiers out of the learner-facing source summary", () => {
    const documentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    render(
      <AppProvider>
        <TeachingTurn
          result={{
            ...chatResponse,
            sources: [
              {
                document_id: documentId,
                source_span_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                excerpt: "检索增强生成结合了检索与生成。",
                page_number: 3,
              },
            ],
          }}
        />
      </AppProvider>,
    );

    fireEvent.click(screen.getByText("查看参考来源"));
    expect(screen.getByText("检索增强生成结合了检索与生成。")).toBeVisible();
    expect(screen.getByText("第 3 页")).toBeVisible();
    expect(screen.queryByText(/aaaaaaaa/)).not.toBeInTheDocument();
    expect(screen.queryByText(/bbbbbbbb/)).not.toBeInTheDocument();
  });
});
