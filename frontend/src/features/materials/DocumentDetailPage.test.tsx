import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "@/stores/AppContext";
import { api } from "@/services/api";
import type { DocumentRecord } from "@/types/api";
import { DocumentDetailPage } from "./DocumentDetailPage";

vi.mock("@/components/shared/RuntimeModelBadge", () => ({
  RuntimeModelBadge: ({ label }: { label?: string }) => <span>{label}</span>,
}));

vi.mock("@/services/api", () => ({
  api: {
    getDocument: vi.fn(),
    getDocumentChunks: vi.fn(),
    getExtractedKnowledge: vi.fn(),
    ingestDocument: vi.fn(),
  },
}));

const workspaceId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";

function record(status: DocumentRecord["status"]): DocumentRecord {
  return {
    id: documentId,
    workspace_id: workspaceId,
    filename: "lesson.txt",
    mime_type: "text/plain",
    byte_size: 12,
    sha256: "a".repeat(64),
    status,
    page_count: status === "INGESTED" ? 1 : null,
    warnings: [],
    created_at: "2026-08-05T00:00:00Z",
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AppProvider>
        <MemoryRouter initialEntries={[`/materials/${documentId}`]}>
          <Routes>
            <Route path="/materials/:documentId" element={<DocumentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AppProvider>
    </QueryClientProvider>,
  );
}

describe("DocumentDetailPage processing guidance", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("does not describe an uploaded but unanalyzed file as successfully processed", async () => {
    vi.mocked(api.getDocument).mockResolvedValue(record("UPLOADED"));
    renderPage();

    expect(
      await screen.findByText(/尚未分析。点击“分析资料并整理知识”/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "分析资料并整理知识" }),
    ).toBeVisible();
    expect(screen.queryByText(/资料分析完成，未发现/)).not.toBeInTheDocument();
  });

  it("asks before analyzing an already processed material again", async () => {
    vi.mocked(api.getDocument).mockResolvedValue(record("INGESTED"));
    vi.mocked(api.ingestDocument).mockResolvedValue({
      document_id: documentId,
      parser: "plain-text",
      page_count: 1,
      chunk_count: 1,
      knowledge_point_count: 1,
      assertion_count: 0,
      warning_count: 0,
      graph_revision_id: null,
      parser_chain: ["plain-text"],
      ocr_used: false,
      vision_used: false,
      detected_language: "zh-CN",
      low_confidence_blocks: 0,
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    const repeat = await screen.findByRole("button", {
      name: "重新分析资料",
    });

    fireEvent.click(repeat);
    expect(confirm).toHaveBeenCalledOnce();
    expect(api.ingestDocument).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(repeat);
    await waitFor(() => expect(api.ingestDocument).toHaveBeenCalledWith(documentId));
  });
});
