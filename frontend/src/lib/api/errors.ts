export type ErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "server"
  | "database_unready"
  | "neo4j_unready"
  | "model_failed"
  | "ocr_failed"
  | "vision_failed"
  | "timeout"
  | "network"
  | "unknown";

const statusMessages: Record<number, string> = {
  400: "请求格式不正确，请检查输入。",
  401: "身份或 Workspace 凭证无效，请重新验证。",
  403: "当前账号没有访问该 Workspace 的权限。",
  404: "找不到请求的资源，请确认 ID 是否正确。",
  409: "资源已存在或状态冲突，请刷新后重试。",
  422: "提交的数据未通过校验，请检查必填项。",
  500: "服务端发生错误，请稍后重试。",
  502: "模型或上游服务暂时不可用。",
  503: "服务尚未准备就绪，请稍后重试。",
  504: "上游服务响应超时，请稍后重试。",
};

export class ApiError extends Error {
  readonly status: number | null;
  readonly kind: ErrorKind;
  readonly technicalDetail: string | null;
  readonly retryable: boolean;
  readonly requestId: string | null;

  constructor(options: {
    message: string;
    status?: number | null;
    kind?: ErrorKind;
    technicalDetail?: string | null;
    retryable?: boolean;
    requestId?: string | null;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.status = options.status ?? null;
    this.kind = options.kind ?? "unknown";
    this.technicalDetail = options.technicalDetail ?? null;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId ?? null;
  }
}

export function errorKindFor(status: number | null, detail: string): ErrorKind {
  const lowered = detail.toLowerCase();
  if (lowered.includes("neo4j")) return "neo4j_unready";
  if (lowered.includes("database") || lowered.includes("postgres"))
    return "database_unready";
  if (lowered.includes("ocr")) return "ocr_failed";
  if (lowered.includes("vision")) return "vision_failed";
  if (lowered.includes("model") || lowered.includes("llm"))
    return "model_failed";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "validation";
  if (status !== null && status >= 500) return "server";
  return status === null ? "network" : "unknown";
}

export function friendlyStatusMessage(
  status: number | null,
  detail = "",
): string {
  const lowered = detail.toLowerCase();
  if (lowered.includes("ocr")) return "OCR 处理失败，请检查 OCR 配置或重试。";
  if (lowered.includes("vision")) return "Vision 处理失败，请检查视觉模型配置或重试。";
  if (lowered.includes("model") || lowered.includes("llm"))
    return "模型服务暂时不可用，请稍后重试。";
  if (
    status === 503 &&
    (detail.toLowerCase().includes("neo4j") ||
      detail.toLowerCase().includes("database"))
  ) {
    return detail.toLowerCase().includes("neo4j")
      ? "Neo4j 尚未准备就绪，图谱功能暂不可用。"
      : "数据库尚未准备就绪，请稍后重试。";
  }
  return status !== null && statusMessages[status]
    ? statusMessages[status]
    : "网络连接失败，请检查服务地址后重试。";
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
