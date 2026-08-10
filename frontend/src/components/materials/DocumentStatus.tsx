import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { UiLocale } from "@/types/app";

const statusLabels: Record<string, Record<UiLocale, string>> = {
  UPLOADED: { "zh-CN": "已上传", en: "Uploaded" },
  PENDING: { "zh-CN": "等待处理", en: "Pending" },
  PARSING: { "zh-CN": "处理中", en: "Processing" },
  INGESTED: { "zh-CN": "可用于学习", en: "Ready to learn" },
  FAILED: { "zh-CN": "处理失败", en: "Needs retry" },
};

export function documentStatusLabel(status: string, locale: UiLocale = "zh-CN"): string {
  return statusLabels[status.trim().toUpperCase()]?.[locale] ?? (locale === "en" ? "Status unavailable" : "状态未知");
}

export function DocumentStatus({ status }: { status: string }) {
  const { locale, pick } = useI18n();
  const normalized = status.trim().toUpperCase();
  const tone =
    normalized === "INGESTED"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
      : normalized === "FAILED"
        ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
        : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  const label = documentStatusLabel(status, locale);
  return (
    <span
      className={cn("rounded-md px-2 py-1 text-[10px] font-semibold", tone)}
      aria-label={pick(`处理状态：${label}`, `Processing status: ${label}`)}
    >
      {label}
    </span>
  );
}
