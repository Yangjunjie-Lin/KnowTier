import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IngestionReport } from "@/types/api";
import { useI18n } from "@/lib/i18n";

export function IngestionSummary({ report }: { report: IngestionReport }) {
  const { pick } = useI18n();
  const outcomeMetrics = [
    [pick("页数", "Pages"), report.page_count],
    [pick("内容分块", "Content sections"), report.chunk_count],
    [pick("知识点", "Knowledge points"), report.knowledge_point_count],
    [pick("关系", "Relationships"), report.assertion_count],
    [pick("低置信度区块", "Low-confidence sections"), report.low_confidence_blocks],
    [pick("警告", "Warnings"), report.warning_count],
  ] as const;
  const technicalMetrics = [
    [pick("内容解析器", "Content parser"), report.parser],
    [pick("解析流程", "Processing pipeline"), report.parser_chain.join(" → ") || pick("未记录", "Not recorded")],
    ["OCR", report.ocr_used ? pick("已使用", "Used") : pick("未使用", "Not used")],
    [pick("图像理解", "Image understanding"), report.vision_used ? pick("已使用", "Used") : pick("未使用", "Not used")],
    [pick("识别语言", "Detected language"), report.detected_language ?? pick("未识别", "Not detected")],
    [pick("图谱版本", "Graph version"), report.graph_revision_id ?? pick("未生成", "Not generated")],
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
      aria-label={pick("本次摄取报告", "Processing report")}
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
        {hasWarnings ? pick("摄取完成，请检查警告", "Processing completed with warnings") : pick("本次摄取完成", "Processing completed")}
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
          {pick("查看处理技术信息", "View technical processing details")}
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
