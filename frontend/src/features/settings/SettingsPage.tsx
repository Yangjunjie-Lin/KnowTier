import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ExternalLink,
  HeartPulse,
  LoaderCircle,
  Moon,
  Palette,
  RotateCcw,
  Save,
  Sun,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/services/api";
import { queryKeys } from "@/lib/queryKeys";
import { sanitizeApiBaseUrl } from "@/lib/utils";
import { useAppStore } from "@/stores/AppContext";
import { ErrorState } from "@/components/shared/States";
import { PageHeader } from "@/components/shared/PageHeader";

export function SettingsPage() {
  const store = useAppStore();
  const [baseUrl, setBaseUrl] = useState(store.preferences.apiBaseUrl);
  const [saved, setSaved] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const health = useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => api.health(signal),
    staleTime: 10_000,
  });
  const readiness = useQuery({
    queryKey: queryKeys.readiness,
    queryFn: ({ signal }) => api.readiness(signal),
    staleTime: 10_000,
    retry: false,
  });
  const saveUrl = () => {
    const normalized = sanitizeApiBaseUrl(baseUrl);
    if (!normalized) {
      setUrlError(
        "API Base URL 只能是相对路径或不含凭据、查询参数的 HTTP(S) 地址。",
      );
      setSaved(false);
      return;
    }
    setUrlError(null);
    store.setApiBaseUrl(normalized);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };
  return (
    <div>
      <PageHeader
        eyebrow="Workspace settings"
        title="设置"
        description="偏好和最近上下文仅保存在本设备；API 密钥与 Provisioning Token 不会保存。"
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-5">
          <SettingSection title="连接">
            <label className="block space-y-2">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                API Base URL
              </span>
              <div className="flex gap-2">
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  className="form-input font-mono text-xs"
                  placeholder="/api"
                />
                <button
                  type="button"
                  onClick={saveUrl}
                  className="secondary-button shrink-0"
                >
                  <Save className="h-4 w-4" />
                  保存
                </button>
              </div>
            </label>
            {urlError && <p className="text-xs text-red-600">{urlError}</p>}
            {saved && (
              <p className="flex items-center gap-1 text-xs text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                已更新，下一次请求使用新地址
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <ContextValue
                label="当前 Workspace"
                value={store.currentWorkspace?.id ?? "未选择"}
              />
              <ContextValue
                label="当前 Learner"
                value={store.currentLearner?.id ?? "未选择"}
              />
              <ContextValue label="当前 Session" value={store.sessionId} mono />
            </div>
          </SettingSection>
          <SettingSection title="外观">
            <div className="space-y-4">
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  主题
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {(["light", "dark", "system"] as const).map((theme) => (
                    <button
                      type="button"
                      key={theme}
                      onClick={() => store.setTheme(theme)}
                      className={`inline-flex items-center justify-center gap-1 rounded-lg border px-3 py-2 text-xs ${store.preferences.theme === theme ? "border-[#3157D5] bg-indigo-50 text-[#3157D5] dark:bg-indigo-950" : "border-slate-200 text-slate-500 dark:border-slate-700"}`}
                    >
                      {theme === "light" ? (
                        <Sun className="h-3.5 w-3.5" />
                      ) : theme === "dark" ? (
                        <Moon className="h-3.5 w-3.5" />
                      ) : (
                        <Palette className="h-3.5 w-3.5" />
                      )}
                      {theme === "light"
                        ? "浅色"
                        : theme === "dark"
                          ? "深色"
                          : "跟随系统"}
                    </button>
                  ))}
                </div>
              </label>
              <ToggleRow
                label="减少动画"
                checked={store.preferences.reducedMotion}
                onChange={store.setReducedMotion}
              />
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  图谱显示密度
                </span>
                <select
                  value={store.preferences.graphDensity}
                  onChange={(event) =>
                    store.setGraphDensity(
                      event.target.value as "comfortable" | "compact" | "dense",
                    )
                  }
                  className="form-input"
                >
                  <option value="comfortable">舒适</option>
                  <option value="compact">紧凑</option>
                  <option value="dense">密集</option>
                </select>
              </label>
            </div>
          </SettingSection>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-[#3157D5]" />
            <h2 className="text-base font-semibold">系统健康状态</h2>
            <button
              type="button"
              onClick={() => {
                void health.refetch();
                void readiness.refetch();
              }}
              className="quiet-button ml-auto min-h-8 px-2"
              aria-label="刷新健康状态"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <HealthCard
              label="Health"
              loading={health.isLoading}
              ok={health.data?.status === "ok"}
              detail={
                health.data?.status === "ok"
                  ? "进程存活"
                  : health.error instanceof Error
                    ? health.error.message
                    : "不可用"
              }
            />
            <HealthCard
              label="PostgreSQL"
              loading={readiness.isLoading}
              ok={readiness.data?.postgres === true}
              detail={String(
                readiness.data?.postgres === true ? "已连接" : "未准备",
              )}
            />
            <HealthCard
              label="Neo4j"
              loading={readiness.isLoading}
              ok={readiness.data?.neo4j === true}
              detail={String(
                readiness.data?.neo4j === true ? "已连接" : "未准备",
              )}
            />
          </div>
          {readiness.isError && (
            <div className="mt-4">
              <ErrorState
                error={readiness.error}
                onRetry={() => void readiness.refetch()}
              />
            </div>
          )}
          <p className="mt-4 text-[11px] leading-5 text-slate-400">
            健康探针来自 `/health` 和 `/ready`。后端没有结构化模型/OCR/Vision
            故障码，摄取失败详情请查看资料警告。
          </p>
        </section>
      </div>
      <section className="mt-5 rounded-xl border border-red-200 bg-white p-5 dark:border-red-900/50 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-red-800 dark:text-red-300">
              本设备记录
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              清除 Workspace、Learner、Document 和 Session
              的本地索引，不影响服务器数据。
            </p>
          </div>
          <button
            type="button"
            onClick={store.clearLocalHistory}
            className="secondary-button border-red-200 text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
            清除本地记录
          </button>
        </div>
      </section>
      <p className="mt-5 text-xs text-slate-400">
        API 文档：
        <a
          className="inline-flex items-center gap-1 text-[#3157D5]"
          href={`${store.preferences.apiBaseUrl.replace(/\/$/, "")}/docs`}
          target="_blank"
          rel="noreferrer"
        >
          打开 Swagger UI <ExternalLink className="h-3 w-3" />
        </a>
      </p>
    </div>
  );
}

function SettingSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}
function ContextValue({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p
        className={`mt-1 break-all text-xs text-slate-700 dark:text-slate-200 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="text-sm text-slate-700 dark:text-slate-200">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#3157D5]/40 ${checked ? "bg-[#3157D5]" : "bg-slate-200 dark:bg-slate-700"}`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`}
        />
      </button>
    </label>
  );
}
function HealthCard({
  label,
  loading,
  ok,
  detail,
}: {
  label: string;
  loading: boolean;
  ok: boolean;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{label}</span>
        {loading ? (
          <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" />
        ) : (
          <span
            className={`h-2.5 w-2.5 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`}
          />
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">{detail}</p>
    </div>
  );
}
