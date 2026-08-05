import { CheckCircle2 } from "lucide-react";
import type { IngestionReport } from "@/types/api";

export function IngestionSummary({ report }: { report: IngestionReport }) {
  const metrics = [
    ["Parser", report.parser],
    ["Parser chain", report.parser_chain.join(" -> ") || "-"],
    ["页数", report.page_count],
    ["内容分块", report.chunk_count],
    ["知识点", report.knowledge_point_count],
    ["关系", report.assertion_count],
    ["OCR", report.ocr_used ? "已使用" : "未使用"],
    ["Vision", report.vision_used ? "已使用" : "未使用"],
    ["语言", report.detected_language ?? "未识别"],
    ["低置信度区块", report.low_confidence_blocks],
    ["警告", report.warning_count],
    ["图谱版本", report.graph_revision_id ?? "未生成"],
  ] as const;
  return (
    <section
      className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-5 dark:border-emerald-900 dark:bg-emerald-950/20"
      aria-label="本次摄取报告"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4" />
        本次摄取完成
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[11px] text-emerald-700/70 dark:text-emerald-400/70">
              {label}
            </dt>
            <dd className="mt-0.5 break-words text-xs text-slate-700 dark:text-slate-200">
              {String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
