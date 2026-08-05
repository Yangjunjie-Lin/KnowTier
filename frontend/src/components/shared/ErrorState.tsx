import { AlertCircle, RefreshCw } from "lucide-react";
import { isApiError } from "@/lib/api/errors";

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const message =
    error instanceof Error ? error.message : "请求失败，请稍后重试。";
  const technicalDetail = isApiError(error) ? error.technicalDetail : null;
  return (
    <div
      className="rounded-xl border border-red-200 bg-red-50 px-5 py-5 dark:border-red-900/60 dark:bg-red-950/30"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertCircle
          className="mt-0.5 h-5 w-5 shrink-0 text-red-600"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-red-900 dark:text-red-200">
            暂时无法完成请求
          </h3>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">
            {message}
          </p>
          {isApiError(error) && (technicalDetail || error.requestId) && (
            <details className="mt-2 text-xs text-red-700/80 dark:text-red-300/80">
              <summary className="cursor-pointer">技术详情</summary>
              <p className="mt-1 break-words font-mono">
                {error.kind}
                {error.requestId ? ` · request ${error.requestId}` : ""}
                {technicalDetail ? ` · ${technicalDetail}` : ""}
              </p>
            </details>
          )}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-400"
            aria-label="重试"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            重试
          </button>
        )}
      </div>
    </div>
  );
}
