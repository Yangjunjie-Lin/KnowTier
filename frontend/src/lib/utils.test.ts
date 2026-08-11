import { describe, expect, it } from "vitest";
import { formatMimeType, sanitizeApiBaseUrl } from "./utils";

describe("formatMimeType", () => {
  it("uses readable document labels without exposing raw MIME values", () => {
    expect(formatMimeType("application/pdf")).toBe("PDF 文档");
    expect(formatMimeType("text/plain")).toBe("文本文档");
    expect(formatMimeType("application/x-internal-format")).toBe("文件");
  });
});

describe("sanitizeApiBaseUrl", () => {
  it("keeps relative paths and safe absolute origins", () => {
    expect(sanitizeApiBaseUrl("/api/")).toBe("/api");
    expect(sanitizeApiBaseUrl("https://example.test/knowtier/")).toBe(
      "https://example.test/knowtier",
    );
  });

  it("rejects credentials and query-string secrets", () => {
    expect(sanitizeApiBaseUrl("https://user:token@example.test/api")).toBeNull();
    expect(sanitizeApiBaseUrl("https://example.test/api?key=secret")).toBeNull();
    expect(sanitizeApiBaseUrl("//example.test/api")).toBeNull();
  });
});
