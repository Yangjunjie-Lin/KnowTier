import { describe, expect, it } from "vitest";
import { sanitizeApiBaseUrl } from "./utils";

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
