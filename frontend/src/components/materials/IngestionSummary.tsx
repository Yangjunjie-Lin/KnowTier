import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IngestionReport } from "@/types/api";

export function IngestionSummary({ report }: { report: IngestionReport }) {
  const outcomeMetrics = [
    ["页数", report.page_count],
    ["内容分块", report.chunk_count],
    ["知识点", report.knowledge_point_count],
    ["关系", report.assertion_count],
    ["低置信度区块", report.low_confidence_blocks],
    ["警告", report.warning_count],
  ] as const;
  const technicalMetrics = [
    ["内容解析器", report.parser],
    ["解析流程", report.parser_chain.join(" → ") || "未记录"],
    ["OCR", report.ocr_used ? "已使用" : "未使用"],
    ["图像理解", report.vision_used ? "已使用" : "未使用"],
    ["识别语言", report.detected_language ?? "未识别"],
    ["图谱版本", report.graph_revision_id ?? "未生成"],
  ] as const;
  const hasWarnings = report.warning_count > 0;
  const StatusIcon = hasWarnings ? AlertTriangle : CheckCircle2;
  return (
    <section
      className={cn(
        "rounded-xl border p-5",
        hasWarnings
          ? "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20"
          : "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20",
      )}
      aria-label="本次摄取报告"
    >
      <div
        className={cn(
          "flex items-center gap-2 text-sm font-semibold",
          hasWarnings
            ? "text-amber-800 dark:text-amber-300"
            : "text-emerald-800 dark:text-emerald-300",
        )}
      >
        <StatusIcon className="h-4 w-4" aria-hidden="true" />
        {hasWarnings ? "摄取完成，请检查警告" : "本次摄取完成"}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {outcomeMetrics.map(([label, value]) => (
          <div
            key={label}
            className="min-w-0 rounded-lg bg-white/70 px-3 py-2 dark:bg-slate-950/30"
          >
            <dt className="text-[11px] text-slate-500">
              {label}
            </dt>
            <dd className="mt-1 break-words font-mono text-base font-semibold text-slate-800 dark:text-slate-100">
              {String(value)}
            </dd>
          </div>
        ))}
      </dl>
      <details className="mt-4 border-t border-current/10 pt-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
          查看处理技术信息
        </summary>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
          {technicalMetrics.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[11px] text-slate-500">{label}</dt>
              <dd className="mt-0.5 break-words font-mono text-xs text-slate-700 dark:text-slate-200">
                {String(value)}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
