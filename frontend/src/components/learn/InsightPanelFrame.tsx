import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import type { LearningInsightPanelState } from "@/features/learn/useLearningInsights";
import { useI18n } from "@/lib/i18n";

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
  const { pick } = useI18n();
  const retry = () => void state.retry();
  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      aria-label={title}
    >
      <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
        {title}
      </h2>

      {!targetId ? (
        <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
          {pick(
            "选择知识点后即可查看",
            "Choose a topic to view this information",
          )}
        </p>
      ) : (
        <>
          {state.isLoading && !hasContent && (
            <p
              className="flex items-center gap-2 text-xs text-slate-500"
              role="status"
            >
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              {pick("正在加载", "Loading")}
            </p>
          )}
          {state.isRefreshing && (
            <p
              className="mb-3 flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200"
              role="status"
            >
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              {pick("正在更新学习记录…", "Updating learning records…")}
            </p>
          )}
          {state.error && !hasContent && !state.isLoading ? (
            <div
              className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
              role="alert"
            >
              <p className="flex items-center gap-2 font-medium">
                <AlertCircle className="h-3.5 w-3.5" />
                {pick("请求失败", "Request failed")}
              </p>
              <button
                type="button"
                className="quiet-button px-2 py-1"
                onClick={retry}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {pick("重试", "Retry")}
              </button>
            </div>
          ) : !state.isLoading || hasContent ? (
            children
          ) : null}
          {state.hasPartialError && (
            <div
              className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
              role="alert"
            >
              <span>
                {pick("部分数据不可用", "Some information is unavailable")}
              </span>
              <button
                type="button"
                className="quiet-button px-2 py-1"
                onClick={retry}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {pick("重试", "Retry")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
