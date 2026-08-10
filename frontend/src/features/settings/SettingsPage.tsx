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
import { teachingModes } from "@/features/learn/teachingLabels";
import { ModelConfigurationSection } from "@/features/settings/ModelConfigurationSection";

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
        "服务地址只能使用相对路径，或不含凭据和查询参数的 HTTP(S) 地址。",
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
        eyebrow="个性化与连接"
        title="设置"
        description="管理模型连接、学习偏好和显示方式。敏感凭据不会写入浏览器偏好。"
      />
      <ModelConfigurationSection />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <SettingSection title="应用服务连接">
            <label className="block space-y-2">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                KnowTier 服务地址（API Base URL）
              </span>
              <div className="flex gap-2">
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  className="form-input font-mono text-xs"
                  placeholder="/api"
                  inputMode="url"
                  spellCheck={false}
                  aria-invalid={urlError ? "true" : undefined}
                  aria-describedby={
                    urlError
                      ? "service-url-help service-url-error"
                      : "service-url-help"
                  }
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
              <span
                id="service-url-help"
                className="block text-[11px] font-normal leading-5 text-slate-500"
              >
                桌面应用通常使用 /api；远程服务可填写不含凭据和查询参数的 HTTPS 地址。
              </span>
            </label>
            {urlError && (
              <p
                id="service-url-error"
                className="text-xs text-red-600"
                role="alert"
              >
                {urlError}
              </p>
            )}
            {saved && (
              <p
                className="flex items-center gap-1 text-xs text-emerald-600"
                role="status"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                已更新，下一次请求使用新地址
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <ContextValue
                label="当前学习空间"
                value={store.currentWorkspace?.name ?? "未选择"}
              />
              <ContextValue
                label="当前学习者"
                value={store.currentLearner?.display_name ?? "未选择"}
              />
              <ContextValue
                label="当前学习会话"
                value={store.sessionId ? "已建立" : "尚未开始"}
              />
            </div>
            <details className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <summary className="cursor-pointer text-xs font-medium text-slate-500">
                查看技术标识
              </summary>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                <ContextValue
                  label="学习空间 ID"
                  value={store.currentWorkspace?.id ?? "未选择"}
                  mono
                />
                <ContextValue
                  label="学习者 ID"
                  value={store.currentLearner?.id ?? "未选择"}
                  mono
                />
                <ContextValue label="会话 ID" value={store.sessionId || "尚未开始"} mono />
              </dl>
            </details>
          </SettingSection>
          <SettingSection title="外观">
            <div className="space-y-4">
              <fieldset className="block space-y-2">
                <legend className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  主题
                </legend>
                <div className="grid grid-cols-3 gap-2">
                  {(["light", "dark", "system"] as const).map((theme) => (
                    <button
                      type="button"
                      key={theme}
                      onClick={() => store.setTheme(theme)}
                      aria-pressed={store.preferences.theme === theme}
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
              </fieldset>
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
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  字体大小
                </span>
                <select
                  value={store.preferences.fontSize}
                  onChange={(event) =>
                    store.setFontSize(
                      event.target.value as "small" | "medium" | "large",
                    )
                  }
                  className="form-input"
                >
                  <option value="small">小</option>
                  <option value="medium">中</option>
                  <option value="large">大</option>
                </select>
              </label>
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  图谱标签显示密度
                </span>
                <select
                  value={store.preferences.graphLabelDensity}
                  onChange={(event) =>
                    store.setGraphLabelDensity(
                      event.target.value as
                        | "minimal"
                        | "balanced"
                        | "detailed",
                    )
                  }
                  className="form-input"
                >
                  <option value="minimal">最少</option>
                  <option value="balanced">平衡</option>
                  <option value="detailed">详细</option>
                </select>
              </label>
            </div>
          </SettingSection>
        </div>
        <div className="space-y-5">
          <SettingSection title="本地学习偏好">
            <div className="space-y-4">
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                这些偏好只影响当前设备，可随时恢复或调整。
              </p>
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  默认教学模式
                </span>
                <select
                  value={store.preferences.defaultTeachingMode}
                  onChange={(event) =>
                    store.setDefaultTeachingMode(
                      event.target.value as
                        | "learn"
                        | "review"
                        | "practice"
                        | "exam"
                        | "research",
                    )
                  }
                  className="form-input"
                >
                  {teachingModes.map((mode) => (
                    <option key={mode.id} value={mode.id}>
                      {mode.label} · {mode.description}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  解释详细程度
                </span>
                <select
                  value={store.preferences.explanationDetail}
                  onChange={(event) =>
                    store.setExplanationDetail(
                      event.target.value as
                        | "concise"
                        | "balanced"
                        | "detailed",
                    )
                  }
                  className="form-input"
                >
                  <option value="concise">简洁</option>
                  <option value="balanced">平衡</option>
                  <option value="detailed">详细</option>
                </select>
              </label>
              <ToggleRow
                label="优先示例"
                checked={store.preferences.prioritizeExamples}
                onChange={store.setPrioritizeExamples}
              />
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  提示强度
                </span>
                <select
                  value={store.preferences.hintStrength}
                  onChange={(event) =>
                    store.setHintStrength(
                      event.target.value as "light" | "balanced" | "strong",
                    )
                  }
                  className="form-input"
                >
                  <option value="light">轻提示</option>
                  <option value="balanced">平衡提示</option>
                  <option value="strong">强提示</option>
                </select>
              </label>
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  复习频率
                </span>
                <select
                  value={store.preferences.reviewFrequency}
                  onChange={(event) =>
                    store.setReviewFrequency(
                      event.target.value as
                        | "daily"
                        | "twice-weekly"
                        | "weekly",
                    )
                  }
                  className="form-input"
                >
                  <option value="daily">每天</option>
                  <option value="twice-weekly">每周两次</option>
                  <option value="weekly">每周一次</option>
                </select>
              </label>
            </div>
          </SettingSection>
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
              disabled={health.isFetching || readiness.isFetching}
              aria-label={
                health.isFetching || readiness.isFetching
                  ? "正在刷新健康状态"
                  : "刷新健康状态"
              }
            >
              <RotateCcw
                className={`h-3.5 w-3.5 ${health.isFetching || readiness.isFetching ? "animate-spin" : ""}`}
              />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <HealthCard
              label="应用服务"
              loading={health.isFetching}
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
              label="学习数据"
              loading={readiness.isFetching}
              ok={readiness.data?.postgres === true}
              detail={String(
                readiness.data?.postgres === true ? "已连接" : "未准备",
              )}
            />
            <HealthCard
              label="知识图谱"
              loading={readiness.isFetching}
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
          <p className="mt-4 text-[11px] leading-5 text-slate-600 dark:text-slate-400">
            若任一项未准备，请刷新重试；资料处理问题会在对应资料详情中显示。
          </p>
          </section>
        </div>
      </div>
      <section className="mt-5 rounded-xl border border-red-200 bg-white p-5 dark:border-red-900/50 dark:bg-slate-900">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-sm font-semibold text-red-800 dark:text-red-300">
              本设备记录
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              清除最近使用的学习空间、学习者、资料和会话记录，不会删除学习数据。
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "清除本设备保存的学习空间、学习者、资料与会话记录？学习数据不会删除。",
                )
              ) {
                store.clearLocalHistory();
              }
            }}
            className="secondary-button w-full border-red-200 text-red-700 hover:bg-red-50 sm:w-auto"
          >
            <Trash2 className="h-4 w-4" />
            清除本地记录
          </button>
        </div>
      </section>
      <details className="mt-5 text-xs text-slate-600 dark:text-slate-400">
        <summary className="cursor-pointer font-medium">开发者工具</summary>
        <a
          className="mt-2 inline-flex items-center gap-1 text-[#3157D5]"
          href={`${store.preferences.apiBaseUrl.replace(/\/$/, "")}/docs`}
          target="_blank"
          rel="noreferrer"
        >
          打开 API 文档 <ExternalLink className="h-3 w-3" />
        </a>
      </details>
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
      <p className="text-[11px] text-slate-600 dark:text-slate-400">{label}</p>
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
  const switchId = `setting-${label.replace(/\s+/g, "-")}`;
  return (
    <div className="flex items-center justify-between gap-3">
      <label
        htmlFor={switchId}
        className="cursor-pointer text-sm text-slate-700 dark:text-slate-200"
      >
        {label}
      </label>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#3157D5]/40 ${checked ? "bg-[#3157D5]" : "bg-slate-200 dark:bg-slate-700"}`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`}
        />
      </button>
    </div>
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
    <div
      className="rounded-lg border border-slate-100 p-3 dark:border-slate-800"
      role="status"
      aria-label={`${label}：${loading ? "检查中" : detail}`}
    >
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
