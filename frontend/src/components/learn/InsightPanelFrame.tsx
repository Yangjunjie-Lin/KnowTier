import { AlertCircle, CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import type { LearningInsightPanelState } from "@/features/learn/useLearningInsights";

function updatedLabel(value: string | null): string {
  if (!value) return "暂无更新时间";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "更新时间由后端提供";
  return `最近更新 ${new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(parsed)}`;
}

export function InsightPanelFrame({
  title,
  targetId,
  state,
  hasContent,
  children,
}: {
  title: string;
  targetId: string | null;
  state: LearningInsightPanelState;
  hasContent: boolean;
  children: ReactNode;
}) {
  const retry = () => void state.retry();
  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      aria-label={title}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </h2>
        {targetId && !state.isLoading && !state.isRefreshing && !state.error && (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            已更新
          </span>
        )}
      </div>

      {!targetId ? (
        <p className="text-xs leading-5 text-slate-400">
          等待服务器确认当前知识点
        </p>
      ) : (
        <>
          {state.isLoading && !hasContent && (
            <p
              className="flex items-center gap-2 text-xs text-slate-500"
              role="status"
            >
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              正在加载
            </p>
          )}
          {state.isRefreshing && (
            <p
              className="mb-3 flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200"
              role="status"
            >
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              正在同步本轮模型变化
            </p>
          )}
          {state.error && !hasContent && !state.isLoading ? (
            <div
              className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
              role="alert"
            >
              <p className="flex items-center gap-2 font-medium">
                <AlertCircle className="h-3.5 w-3.5" />
                请求失败
              </p>
              <button type="button" className="quiet-button px-2 py-1" onClick={retry}>
                <RefreshCw className="h-3.5 w-3.5" />
                重试
              </button>
            </div>
          ) : (
            !state.isLoading || hasContent ? children : null
          )}
          {state.hasPartialError && (
            <div
              className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
              role="alert"
            >
              <span>部分数据不可用</span>
              <button type="button" className="quiet-button px-2 py-1" onClick={retry}>
                <RefreshCw className="h-3.5 w-3.5" />
                重试
              </button>
            </div>
          )}
          <p className="mt-3 text-[10px] text-slate-400">
            {updatedLabel(state.lastUpdatedAt)}
          </p>
        </>
      )}
    </section>
  );
}
