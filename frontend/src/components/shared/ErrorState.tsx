import { AlertCircle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { isApiError, isUserFacingError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n";

export function ErrorState({
  error,
  onRetry,
  action,
}: {
  error: unknown;
  onRetry?: () => void;
  action?: ReactNode;
}) {
  const { pick, t } = useI18n();
  const message =
    isApiError(error)
      ? friendlyApiMessage(error.status, error.kind, pick)
      : isUserFacingError(error)
        ? error.message
        : pick(
            "服务暂时无法完成请求，请稍后重试。",
            "The service could not complete this request. Please try again.",
          );
  const technicalDetail = isApiError(error) ? error.technicalDetail : null;
  return (
    <div
      className="rounded-2xl border border-red-200 bg-red-50/90 px-4 py-4 shadow-[0_1px_2px_rgba(127,29,29,0.04)] sm:px-5 sm:py-5 dark:border-red-900/60 dark:bg-red-950/30"
      role="alert"
    >
      <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
        <AlertCircle
          className="mt-0.5 h-5 w-5 shrink-0 text-red-600"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-red-900 dark:text-red-200">
            {pick("暂时无法完成请求", "We could not complete this request")}
          </h3>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">
            {message}
          </p>
          {isApiError(error) && (technicalDetail || error.requestId) && (
            <details className="mt-2 text-xs text-red-700/80 dark:text-red-300/80">
              <summary className="cursor-pointer">{pick("技术详情", "Technical details")}</summary>
              <p className="mt-1 break-words font-mono">
                {error.kind}
                {error.requestId ? ` · request ${error.requestId}` : ""}
                {technicalDetail ? ` · ${technicalDetail}` : ""}
              </p>
            </details>
          )}
        </div>
        {(onRetry || action) && (
          <div className="ml-8 flex w-full shrink-0 flex-wrap items-center gap-2 sm:ml-0 sm:w-auto">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-400"
                aria-label={t("common.retry")}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                {t("common.retry")}
              </button>
            )}
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

function friendlyApiMessage(
  status: number | null,
  kind: string,
  pick: (chinese: string, english: string) => string,
): string {
  if (status === 401) return pick("身份信息已失效，请重新连接。", "Your session is no longer valid. Reconnect to continue.");
  if (status === 403) return pick("当前学习空间不允许执行此操作。", "This action is not allowed in the current workspace.");
  if (status === 404) return pick("没有找到对应内容，它可能已被移动或删除。", "This content could not be found. It may have been moved or removed.");
  if (status === 409) return pick("内容已发生变化，请刷新后重试。", "This content changed. Refresh and try again.");
  if (status === 422 || kind === "validation") return pick("提交内容不完整，请检查后重试。", "Some submitted information is incomplete. Check it and try again.");
  if (status === 429) return pick("请求较多，请稍后再试。", "There are too many requests right now. Try again shortly.");
  if (kind === "timeout") return pick("响应时间过长，请重试或调整模型超时。", "The response took too long. Retry or adjust the model timeout.");
  if (kind === "network") return pick("无法连接服务，请检查网络后重试。", "Could not reach the service. Check the network and try again.");
  if (kind === "model_failed") return pick("模型暂时没有完成请求，请重试或检查模型配置。", "The model could not complete this request. Retry or check the model configuration.");
  return pick("服务暂时无法完成请求，请稍后重试。", "The service could not complete this request. Try again shortly.");
}
