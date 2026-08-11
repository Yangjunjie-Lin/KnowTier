import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client";
import type { ApiError } from "./errors";

describe("ApiClient", () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("injects the workspace scope and parses JSON", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient("/api", 1_000);
    client.setWorkspaceId("11111111-1111-4111-8111-111111111111");
    await expect(client.get<{ ok: boolean }>("/v1/example")).resolves.toEqual({
      ok: true,
    });
    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toBe("/api/v1/example");
    expect(new Headers(request?.[1]?.headers).get("X-Workspace-ID")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("shares the current workspace across hot-reloaded client instances", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const contextClient = new ApiClient("/api", 1_000, true);
    const serviceClient = new ApiClient("/api", 1_000, true);
    contextClient.setWorkspaceId("11111111-1111-4111-8111-111111111111");

    await serviceClient.get("/v1/example");

    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("X-Workspace-ID"),
    ).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("does not leak workspace scope to provisioning calls", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "workspace" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient("/api", 1_000);
    client.setWorkspaceId("11111111-1111-4111-8111-111111111111");
    await client.post(
      "/v1/workspaces",
      { name: "Test" },
      { workspaceScoped: false },
    );
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has("X-Workspace-ID"),
    ).toBe(false);
  });

  it("keeps the model configuration token in memory and scopes it to configuration calls", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient("/api", 1_000);
    client.setModelConfigurationToken("admin-session-token");
    await client.get("/v1/model-config");
    await client.get("/v1/health");
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get(
        "X-Model-Configuration-Token",
      ),
    ).toBe("admin-session-token");
    expect(
      new Headers(fetchMock.mock.calls[1]?.[1]?.headers).has(
        "X-Model-Configuration-Token",
      ),
    ).toBe(false);
  });

  it("maps FastAPI validation errors to a Chinese ApiError with technical detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: [
            {
              loc: ["body", "slug"],
              msg: "String should match pattern",
              type: "string_pattern_mismatch",
            },
          ],
        }),
        {
          status: 422,
          headers: {
            "content-type": "application/json",
            "x-request-id": "req-1",
          },
        },
      ),
    );
    const client = new ApiClient("/api", 1_000);
    await expect(
      client.post("/v1/workspaces", { slug: "INVALID" }),
    ).rejects.toMatchObject({
      status: 422,
      kind: "validation",
      message: "提交的数据未通过校验，请检查必填项。",
      requestId: "req-1",
    } satisfies Partial<ApiError>);
  });

  it("times out stalled requests", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    );
    const client = new ApiClient("/api", 5);
    await expect(client.get("/slow", { retries: 0 })).rejects.toMatchObject({
      kind: "timeout",
    } satisfies Partial<ApiError>);
  });

  it("preserves caller cancellation without retrying it as a network error", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    );
    const controller = new AbortController();
    const client = new ApiClient("/api", 1_000);
    const request = client.get("/cancelled", {
      signal: controller.signal,
      retries: 2,
    });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the readiness payload when the endpoint returns an accepted 503", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ postgres: true, neo4j: false, ready: false }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient("/api", 1_000);
    await expect(
      client.get<{ postgres: boolean; neo4j: boolean; ready: boolean }>("/ready", {
        workspaceScoped: false,
        acceptedStatuses: [503],
      }),
    ).resolves.toEqual({ postgres: true, neo4j: false, ready: false });
  });

  it("surfaces 429 as a retryable rate-limit error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "rate limit reached" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient("/api", 1_000);
    await expect(client.get("/limited", { retries: 0 })).rejects.toMatchObject({
      status: 429,
      kind: "rate_limited",
      retryable: true,
      message: "请求过于频繁或模型额度受限，请稍后重试。",
    } satisfies Partial<ApiError>);
  });
});
