export function cn(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

export function formatDate(
  value: string | null | undefined,
  withTime = false,
): string {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无";
  return new Intl.DateTimeFormat(
    "zh-CN",
    withTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" },
  ).format(date);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const mimeTypeLabels: Record<string, string> = {
  "application/pdf": "PDF 文档",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "Word 文档",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "PowerPoint 演示文稿",
  "text/plain": "文本文档",
  "text/markdown": "Markdown 文档",
  "image/png": "PNG 图像",
  "image/jpeg": "JPEG 图像",
  "image/tiff": "TIFF 图像",
};

export function formatMimeType(value: string | null | undefined): string {
  if (!value) return "文件";
  return mimeTypeLabels[value.trim().toLowerCase()] ?? "文件";
}

export function percent(value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
}

export function displayPercent(value: number | null | undefined): string {
  return `${Math.round(percent(value))}%`;
}

export function jsonText(value: unknown): string {
  if (value === null || value === undefined) return "暂无";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

/** Keep connection settings free of credentials and query-string secrets. */
export function sanitizeApiBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return "/api";
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    if (raw.includes("?") || raw.includes("#")) return null;
    return raw.replace(/\/+$/, "") || "/";
  }
  try {
    const parsed = new URL(raw);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      return null;
    return (
      `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "") || parsed.origin
    );
  } catch {
    return null;
  }
}

export function downloadText(
  filename: string,
  content: string,
  type = "text/plain;charset=utf-8",
): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function triggerResponseDownload(
  response: Response,
  fallbackName: string,
): Promise<void> {
  return response.blob().then((blob) => {
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename =
      disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? fallbackName;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  });
}
