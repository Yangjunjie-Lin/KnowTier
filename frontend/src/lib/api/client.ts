import { ApiError, errorKindFor, friendlyStatusMessage } from "./errors";
import type { JsonValue } from "@/types/api";

export interface RequestOptions extends Omit<RequestInit, "body" | "signal"> {
  body?: BodyInit | JsonValue | object;
  signal?: AbortSignal;
  workspaceScoped?: boolean;
  timeoutMs?: number;
  retries?: number;
  /** Some health endpoints intentionally return a useful non-2xx payload. */
  acceptedStatuses?: readonly number[];
}

function isBodyInit(value: unknown): value is BodyInit {
  return (
    typeof value === "string" ||
    value instanceof FormData ||
    value instanceof Blob ||
    value instanceof URLSearchParams ||
    value instanceof ArrayBuffer
  );
}

function mergeSignals(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort("timeout"), timeoutMs);
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

function cancellationError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("The request was cancelled.", "AbortError");
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(cancellationError(signal));
  return new Promise((resolve, reject) => {
    let timer = 0;
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const abort = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(cancellationError(signal));
    };
    timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function readPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  try {
    return await response.text();
  } catch {
    return null;
  }
}

function detailText(payload: unknown): string {
  if (typeof payload === "string" && payload.trim()) return payload;
  if (payload && typeof payload === "object") {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item) => {
          if (!item || typeof item !== "object") return String(item);
          const message = (item as { msg?: unknown }).msg;
          const location = (item as { loc?: unknown }).loc;
          const messageText = typeof message === "string" ? message : "";
          return `${Array.isArray(location) ? location.join(".") : ""}${messageText ? `: ${messageText}` : ""}`.trim();
        })
        .filter(Boolean)
        .join("；");
    }
    if (typeof detail === "object" && detail !== null)
      return JSON.stringify(detail);
  }
  return "";
}

export class ApiClient {
  private configuredBaseUrl: string;
  readonly defaultTimeoutMs: number;
  private workspaceId: string | null = null;

  constructor(
    baseUrl: string = typeof import.meta.env.VITE_API_BASE_URL === "string"
      ? import.meta.env.VITE_API_BASE_URL
      : "/api",
    defaultTimeoutMs: number = typeof import.meta.env.VITE_API_TIMEOUT_MS ===
    "string"
      ? Number(import.meta.env.VITE_API_TIMEOUT_MS)
      : 30_000,
  ) {
    this.configuredBaseUrl = baseUrl.replace(/\/$/, "");
    this.defaultTimeoutMs = Number.isFinite(defaultTimeoutMs)
      ? defaultTimeoutMs
      : 30_000;
  }

  setWorkspaceId(workspaceId: string | null): void {
    this.workspaceId = workspaceId;
  }
  getWorkspaceId(): string | null {
    return this.workspaceId;
  }
  setBaseUrl(baseUrl: string): void {
    this.configuredBaseUrl = baseUrl.trim().replace(/\/$/, "") || "/api";
  }
  getBaseUrl(): string {
    return this.configuredBaseUrl;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = (options.method ?? "GET").toUpperCase();
    const retries =
      options.retries ?? (method === "GET" || method === "HEAD" ? 2 : 0);
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const headers = new Headers(options.headers);
    if (options.workspaceScoped !== false && this.workspaceId)
      headers.set("X-Workspace-ID", this.workspaceId);
    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      if (isBodyInit(options.body)) body = options.body;
      else {
        body = JSON.stringify(options.body);
        headers.set("Content-Type", "application/json");
      }
    }
    let lastError: ApiError | null = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      options.signal?.throwIfAborted();
      const merged = mergeSignals(options.signal, timeoutMs);
      try {
        const requestInit: RequestInit = {
          cache: options.cache,
          credentials: options.credentials,
          integrity: options.integrity,
          keepalive: options.keepalive,
          mode: options.mode,
          redirect: options.redirect,
          referrer: options.referrer,
          referrerPolicy: options.referrerPolicy,
        };
        const response = await fetch(`${this.configuredBaseUrl}${path}`, {
          ...requestInit,
          method,
          headers,
          body: body ?? null,
          signal: merged.signal,
        });
        const payload = await readPayload(response);
        const requestId = response.headers.get("x-request-id");
        if (
          !response.ok &&
          options.acceptedStatuses?.includes(response.status)
        ) {
          return payload as T;
        }
        if (!response.ok) {
          const detail = detailText(payload);
          const error = new ApiError({
            message: friendlyStatusMessage(response.status, detail),
            status: response.status,
            kind: errorKindFor(response.status, detail),
            technicalDetail: detail || null,
            retryable:
              response.status === 408 ||
              response.status === 429 ||
              response.status >= 500,
            requestId,
          });
          lastError = error;
          if (!error.retryable || attempt >= retries) throw error;
          await waitForRetry(
            Math.min(250 * (attempt + 1), 1000),
            options.signal,
          );
          continue;
        }
        return payload as T;
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (error instanceof ApiError) {
          lastError = error;
          if (!error.retryable || attempt >= retries) throw error;
          continue;
        }
        const timedOut =
          merged.signal.aborted && merged.signal.reason === "timeout";
        const apiError = new ApiError({
          message: timedOut
            ? "请求超时，请稍后重试。"
            : "无法连接到 KnowTier 服务，请检查 API 地址。",
          kind: timedOut ? "timeout" : "network",
          technicalDetail:
            error instanceof Error ? error.message : String(error),
          retryable: true,
        });
        lastError = apiError;
        if (attempt >= retries) throw apiError;
      } finally {
        merged.cleanup();
      }
    }
    throw lastError ?? new ApiError({ message: "请求失败。", kind: "unknown" });
  }

  get<T>(
    path: string,
    options: Omit<RequestOptions, "method" | "body"> = {},
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: "GET" });
  }
  post<T>(
    path: string,
    body?: JsonValue | BodyInit | object,
    options: Omit<RequestOptions, "method" | "body"> = {},
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: "POST", body });
  }

  async download(
    path: string,
    options: Omit<RequestOptions, "method" | "body"> = {},
  ): Promise<Response> {
    const retries = options.retries ?? 2;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    let lastError: ApiError | null = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      options.signal?.throwIfAborted();
      const merged = mergeSignals(options.signal, timeoutMs);
      try {
        const response = await fetch(`${this.configuredBaseUrl}${path}`, {
          method: "GET",
          headers: this.scopedHeaders(options.headers, options.workspaceScoped),
          cache: options.cache,
          credentials: options.credentials,
          integrity: options.integrity,
          keepalive: options.keepalive,
          mode: options.mode,
          redirect: options.redirect,
          referrer: options.referrer,
          referrerPolicy: options.referrerPolicy,
          signal: merged.signal,
        });
        if (response.ok) return response;
        const payload = await readPayload(response);
        const detail = detailText(payload);
        const error = new ApiError({
          message: friendlyStatusMessage(response.status, detail),
          status: response.status,
          kind: errorKindFor(response.status, detail),
          technicalDetail: detail || null,
          retryable:
            response.status === 408 ||
            response.status === 429 ||
            response.status >= 500,
          requestId: response.headers.get("x-request-id"),
        });
        lastError = error;
        if (!error.retryable || attempt >= retries) throw error;
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (error instanceof ApiError) {
          lastError = error;
          if (!error.retryable || attempt >= retries) throw error;
        } else {
          const timedOut =
            merged.signal.aborted && merged.signal.reason === "timeout";
          const apiError = new ApiError({
            message: timedOut
              ? "请求超时，请稍后重试。"
              : "无法连接到 KnowTier 服务，请检查 API 地址。",
            kind: timedOut ? "timeout" : "network",
            technicalDetail:
              error instanceof Error ? error.message : String(error),
            retryable: true,
          });
          lastError = apiError;
          if (attempt >= retries) throw apiError;
        }
      } finally {
        merged.cleanup();
      }
    }
    throw lastError ?? new ApiError({ message: "请求失败。", kind: "unknown" });
  }

  private scopedHeaders(input?: HeadersInit, workspaceScoped = true): Headers {
    const headers = new Headers(input);
    if (workspaceScoped && this.workspaceId)
      headers.set("X-Workspace-ID", this.workspaceId);
    return headers;
  }
}

export const apiClient = new ApiClient();
