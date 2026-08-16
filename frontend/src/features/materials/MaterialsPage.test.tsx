import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "@/stores/AppContext";
import { api } from "@/services/api";
import type { RecentDocument } from "@/types/app";
import type { DocumentRecord } from "@/types/api";
import { MaterialsPage } from "./MaterialsPage";

vi.mock("@/services/api", () => ({
  api: {
    uploadDocument: vi.fn(),
    listDocuments: vi.fn(),
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
  byte_size: 11,
  sha256: "a".repeat(64),
  status: "UPLOADED",
  page_count: null,
  warnings: [],
  created_at: "2026-08-05T00:00:00Z",
};

afterEach(cleanup);

function renderPage(recentDocuments: RecentDocument[] = []) {
  localStorage.setItem(
    "knowtier.app-state.v1",
    JSON.stringify({
      version: 1,
      currentWorkspace: workspace,
      currentLearner: learner,
      currentDocumentId: null,
      sessionId: "44444444-4444-4444-8444-444444444444",
      recentWorkspaces: [workspace],
      recentLearners: [learner],
      recentDocuments,
      preferences: {
        apiBaseUrl: "/api",
        uiLocale: "zh-CN",
        theme: "light",
        reducedMotion: false,
        graphDensity: "comfortable",
        defaultTeachingMode: "learn",
        explanationDetail: "balanced",
        prioritizeExamples: true,
        hintStrength: "balanced",
        reviewFrequency: "twice-weekly",
        fontSize: "medium",
        graphLabelDensity: "balanced",
      },
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AppProvider>
        <MemoryRouter initialEntries={["/materials"]}>
          <Routes>
            <Route path="/materials" element={<MaterialsPage />} />
            <Route path="/materials/:documentId" element={<p>Material destination</p>} />
          </Routes>
        </MemoryRouter>
      </AppProvider>
    </QueryClientProvider>,
  );
}

function dataTransferFor(file: File) {
  return {
    dropEffect: "none",
    files: {
      0: file,
      length: 1,
      item: () => file,
    },
  };
}

describe("MaterialsPage upload entry", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(api.listDocuments).mockResolvedValue({
      workspace_id: workspace.id,
      items: [],
      limit: 100,
      offset: 0,
      next_offset: null,
    });
  });

  it("uploads a supported material dropped onto the prominent drop zone", async () => {
    vi.mocked(api.uploadDocument).mockResolvedValue(uploadedDocument);
    renderPage();
    const file = new File(["lesson text"], "lesson.txt", {
      type: "text/plain",
    });

    fireEvent.drop(screen.getByTestId("material-drop-zone"), {
      dataTransfer: dataTransferFor(file),
    });

    await waitFor(() =>
      expect(api.uploadDocument).toHaveBeenCalledWith(workspace.id, file),
    );
    expect(await screen.findByText("Material destination")).toBeVisible();
  });

  it("explains unsupported file types before making a request", async () => {
    renderPage();
    const file = new File(["binary"], "lesson.exe", {
      type: "application/octet-stream",
    });

    fireEvent.drop(screen.getByTestId("material-drop-zone"), {
      dataTransfer: dataTransferFor(file),
    });

    expect(
      await screen.findByText(/暂不支持这种文件/),
    ).toBeVisible();
    expect(api.uploadDocument).not.toHaveBeenCalled();
  });

  it("shows persisted workspace materials when local recent history is empty", async () => {
    vi.mocked(api.listDocuments).mockResolvedValue({
      workspace_id: workspace.id,
      items: [uploadedDocument],
      limit: 100,
      offset: 0,
      next_offset: null,
    });

    renderPage([]);

    expect(await screen.findByText("lesson.txt")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "查看 lesson.txt 的详情" }),
    ).toHaveAttribute("href", `/materials/${uploadedDocument.id}`);
    expect(api.listDocuments).toHaveBeenCalledWith(
      workspace.id,
      expect.any(AbortSignal),
      0,
    );
  });

  it("loads older server materials instead of silently stopping at one page", async () => {
    const olderDocument = {
      ...uploadedDocument,
      id: "44444444-4444-4444-8444-444444444444",
      filename: "older-notes.md",
    };
    vi.mocked(api.listDocuments).mockImplementation(
      (_workspaceId, _signal, offset = 0) =>
        Promise.resolve(
          offset === 0
            ? {
                workspace_id: workspace.id,
                items: [uploadedDocument],
                limit: 100,
                offset: 0,
                next_offset: 100,
              }
            : {
                workspace_id: workspace.id,
                items: [olderDocument],
                limit: 100,
                offset,
                next_offset: null,
              },
        ),
    );
    renderPage([]);

    fireEvent.click(
      await screen.findByRole("button", { name: "加载更多资料" }),
    );

    expect(await screen.findByText("older-notes.md")).toBeVisible();
    expect(api.listDocuments).toHaveBeenLastCalledWith(
      workspace.id,
      expect.any(AbortSignal),
      100,
    );
  });

  it("uses the server copy when a local recent record has the same id", async () => {
    vi.mocked(api.listDocuments).mockResolvedValue({
      workspace_id: workspace.id,
      items: [{ ...uploadedDocument, filename: "server-name.txt", status: "INGESTED" }],
      limit: 100,
      offset: 0,
      next_offset: null,
    });

    renderPage([
      {
        id: uploadedDocument.id,
        workspaceId: workspace.id,
        filename: "stale-local-name.txt",
        mimeType: "text/plain",
        status: "UPLOADED",
        createdAt: uploadedDocument.created_at,
      },
    ]);

    expect(await screen.findByText("server-name.txt")).toBeVisible();
    expect(screen.queryByText("stale-local-name.txt")).not.toBeInTheDocument();
  });
});
