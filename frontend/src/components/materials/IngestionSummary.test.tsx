import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { IngestionReport } from "@/types/api";
import { IngestionSummary } from "./IngestionSummary";

afterEach(cleanup);

function report(overrides: Partial<IngestionReport> = {}): IngestionReport {
  return {
    document_id: "11111111-1111-4111-8111-111111111111",
    parser: "pdf-text",
    page_count: 12,
    chunk_count: 24,
    knowledge_point_count: 8,
    assertion_count: 11,
    warning_count: 0,
    graph_revision_id: "22222222-2222-4222-8222-222222222222",
    parser_chain: ["pdf-text", "layout"],
    ocr_used: false,
    vision_used: false,
    detected_language: "zh",
    low_confidence_blocks: 0,
    ...overrides,
  };
}

describe("IngestionSummary", () => {
  it("prioritizes learning outcomes and keeps processing details available", () => {
    render(<IngestionSummary report={report()} />);

    expect(screen.getByText("本次摄取完成")).toBeInTheDocument();
    expect(screen.getByText("知识点")).toBeInTheDocument();
    expect(screen.getByText("查看处理技术信息")).toBeInTheDocument();
    expect(screen.getByText("内容解析器")).toBeInTheDocument();
  });

  it("does not present a warning-bearing ingestion as an unqualified success", () => {
    render(
      <IngestionSummary
        report={report({ warning_count: 2, low_confidence_blocks: 1 })}
      />,
    );

    expect(screen.getByText("摄取完成，请检查警告")).toBeInTheDocument();
  });
});
