import { cn } from "@/lib/utils";

const statusLabels: Record<string, string> = {
  UPLOADED: "已上传",
  PENDING: "等待处理",
  PARSING: "处理中",
  INGESTED: "可用于学习",
  FAILED: "处理失败",
};

export function documentStatusLabel(status: string): string {
  return statusLabels[status.trim().toUpperCase()] ?? "状态未知";
}

export function DocumentStatus({ status }: { status: string }) {
  const normalized = status.trim().toUpperCase();
  const tone =
    normalized === "INGESTED"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
      : normalized === "FAILED"
        ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
        : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  const label = documentStatusLabel(status);
  return (
    <span
      className={cn("rounded-md px-2 py-1 text-[10px] font-semibold", tone)}
      aria-label={`处理状态：${label}`}
    >
      {label}
    </span>
  );
}
