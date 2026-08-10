import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ExternalLink,
  HeartPulse,
  LoaderCircle,
  Languages,
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
import { useI18n } from "@/lib/i18n";

export function SettingsPage() {
  const store = useAppStore();
  const { locale, setLocale, pick, t } = useI18n();
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
        pick(
          "服务地址只能使用相对路径，或不含凭据和查询参数的 HTTP(S) 地址。",
          "Use a relative path or an HTTP(S) address without credentials or query parameters.",
        ),
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
        eyebrow={pick("个性化与连接", "Personalization and connections")}
        title={t("nav.settings")}
        description={pick(
          "管理模型连接、学习偏好和显示方式。敏感凭据不会写入浏览器偏好。",
          "Manage model connections, learning preferences, and appearance. Sensitive credentials are never stored in browser preferences.",
        )}
      />
      <ModelConfigurationSection />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <SettingSection title={pick("应用服务连接", "Application service")}>
            <label className="block space-y-2">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {pick("KnowTier 服务地址（API Base URL）", "KnowTier service address (API Base URL)")}
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
                  {t("common.save")}
                </button>
              </div>
              <span
                id="service-url-help"
                className="block text-[11px] font-normal leading-5 text-slate-500"
              >
                {pick(
                  "桌面应用通常使用 /api；远程服务可填写不含凭据和查询参数的 HTTPS 地址。",
                  "The desktop app normally uses /api. For a remote service, enter an HTTPS address without credentials or query parameters.",
                )}
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
                {pick("已更新，下一次请求使用新地址", "Updated. New requests will use this address.")}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <ContextValue
                label={pick("当前学习空间", "Current workspace")}
                value={store.currentWorkspace?.name ?? pick("未选择", "Not selected")}
              />
              <ContextValue
                label={pick("当前学习者", "Current learner")}
                value={store.currentLearner?.display_name ?? pick("未选择", "Not selected")}
              />
              <ContextValue
                label={pick("当前学习会话", "Current learning session")}
                value={store.sessionId ? pick("已建立", "Active") : pick("尚未开始", "Not started")}
              />
            </div>
            <details className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <summary className="cursor-pointer text-xs font-medium text-slate-500">
                {pick("查看技术标识", "View technical identifiers")}
              </summary>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                <ContextValue
                  label={pick("学习空间 ID", "Workspace ID")}
                  value={store.currentWorkspace?.id ?? pick("未选择", "Not selected")}
                  mono
                />
                <ContextValue
                  label={pick("学习者 ID", "Learner ID")}
                  value={store.currentLearner?.id ?? pick("未选择", "Not selected")}
                  mono
                />
                <ContextValue label={pick("会话 ID", "Session ID")} value={store.sessionId || pick("尚未开始", "Not started")} mono />
              </dl>
            </details>
          </SettingSection>
          <SettingSection title={pick("外观与语言", "Appearance and language")}>
            <div className="space-y-4">
              <label className="block space-y-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                  <Languages className="h-3.5 w-3.5" aria-hidden="true" />
                  {pick("界面语言", "Interface language")}
                </span>
                <select
                  value={locale}
                  onChange={(event) => setLocale(event.target.value === "en" ? "en" : "zh-CN")}
                  className="form-input"
                >
                  <option value="zh-CN">中文</option>
                  <option value="en">English</option>
                </select>
              </label>
              <fieldset className="block space-y-2">
                <legend className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {pick("主题", "Theme")}
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
                        ? pick("浅色", "Light")
                        : theme === "dark"
                          ? pick("深色", "Dark")
                          : pick("跟随系统", "System")}
                    </button>
                  ))}
                </div>
              </fieldset>
              <ToggleRow
                label={pick("减少动画", "Reduce motion")}
                checked={store.preferences.reducedMotion}
                onChange={store.setReducedMotion}
              />
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {pick("图谱显示密度", "Graph density")}
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
                  <option value="comfortable">{pick("舒适", "Comfortable")}</option>
                  <option value="compact">{pick("紧凑", "Compact")}</option>
                  <option value="dense">{pick("密集", "Dense")}</option>
                </select>
              </label>
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {pick("字体大小", "Font size")}
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
                  <option value="small">{pick("小", "Small")}</option>
                  <option value="medium">{pick("中", "Medium")}</option>
                  <option value="large">{pick("大", "Large")}</option>
                </select>
              </label>
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {pick("图谱标签显示密度", "Graph label detail")}
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
                  <option value="minimal">{pick("最少", "Minimal")}</option>
                  <option value="balanced">{pick("平衡", "Balanced")}</option>
                  <option value="detailed">{pick("详细", "Detailed")}</option>
                </select>
              </label>
            </div>
          </SettingSection>
        </div>
        <div className="space-y-5">
          <SettingSection title={pick("本地学习偏好", "Learning preferences")}>
            <div className="space-y-4">
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                {pick(
                  "这些偏好只影响当前设备，可随时恢复或调整。学习空间只显示当前教学任务，详细偏好统一在这里管理。",
                  "These preferences apply only to this device. The learning workspace stays focused on the current lesson; detailed preferences are managed here.",
                )}
              </p>
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {pick("默认教学模式", "Default teaching mode")}
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
                      {locale === "en" ? mode.labelEn : mode.label} · {locale === "en" ? mode.descriptionEn : mode.description}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {pick("解释详细程度", "Explanation detail")}
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
                  <option value="concise">{pick("简洁", "Concise")}</option>
                  <option value="balanced">{pick("平衡", "Balanced")}</option>
                  <option value="detailed">{pick("详细", "Detailed")}</option>
                </select>
              </label>
              <ToggleRow
                label={pick("优先示例", "Prioritize examples")}
                checked={store.preferences.prioritizeExamples}
                onChange={store.setPrioritizeExamples}
              />
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {pick("提示强度", "Hint strength")}
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
                  <option value="light">{pick("轻提示", "Light hints")}</option>
                  <option value="balanced">{pick("平衡提示", "Balanced hints")}</option>
                  <option value="strong">{pick("强提示", "Strong hints")}</option>
                </select>
              </label>
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {pick("复习频率", "Review frequency")}
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
                  <option value="daily">{pick("每天", "Daily")}</option>
                  <option value="twice-weekly">{pick("每周两次", "Twice a week")}</option>
                  <option value="weekly">{pick("每周一次", "Weekly")}</option>
                </select>
              </label>
            </div>
          </SettingSection>
          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-[#3157D5]" />
            <h2 className="text-base font-semibold">{pick("系统健康状态", "System health")}</h2>
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
                  ? pick("正在刷新健康状态", "Refreshing system health")
                  : pick("刷新健康状态", "Refresh system health")
              }
            >
              <RotateCcw
                className={`h-3.5 w-3.5 ${health.isFetching || readiness.isFetching ? "animate-spin" : ""}`}
              />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <HealthCard
              label={pick("应用服务", "Application service")}
              loading={health.isFetching}
              ok={health.data?.status === "ok"}
              detail={
                health.data?.status === "ok"
                  ? pick("进程存活", "Running")
                  : pick("不可用", "Unavailable")
              }
            />
            <HealthCard
              label={pick("学习数据", "Learning data")}
              loading={readiness.isFetching}
              ok={readiness.data?.postgres === true}
              detail={String(
                readiness.data?.postgres === true ? pick("已连接", "Connected") : pick("未准备", "Not ready"),
              )}
            />
            <HealthCard
              label={pick("知识图谱", "Knowledge graph")}
              loading={readiness.isFetching}
              ok={readiness.data?.neo4j === true}
              detail={String(
                readiness.data?.neo4j === true ? pick("已连接", "Connected") : pick("未准备", "Not ready"),
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
            {pick(
              "若任一项未准备，请刷新重试；资料处理问题会在对应资料详情中显示。",
              "If a service is not ready, refresh and retry. Material-processing issues appear on the relevant material page.",
            )}
          </p>
          </section>
        </div>
      </div>
      <section className="mt-5 rounded-xl border border-red-200 bg-white p-5 dark:border-red-900/50 dark:bg-slate-900">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-sm font-semibold text-red-800 dark:text-red-300">
              {pick("本设备记录", "This device")}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {pick(
                "清除最近使用的学习空间、学习者、资料和会话记录，不会删除学习数据。",
                "Clear recent workspaces, learners, materials, and sessions from this device without deleting learning data.",
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  pick(
                    "清除本设备保存的学习空间、学习者、资料与会话记录？学习数据不会删除。",
                    "Clear saved workspaces, learners, materials, and sessions from this device? Learning data will not be deleted.",
                  ),
                )
              ) {
                store.clearLocalHistory();
              }
            }}
            className="secondary-button w-full border-red-200 text-red-700 hover:bg-red-50 sm:w-auto"
          >
            <Trash2 className="h-4 w-4" />
            {pick("清除本地记录", "Clear local history")}
          </button>
        </div>
      </section>
      <details className="mt-5 text-xs text-slate-600 dark:text-slate-400">
        <summary className="cursor-pointer font-medium">{pick("开发者工具", "Developer tools")}</summary>
        <a
          className="mt-2 inline-flex items-center gap-1 text-[#3157D5]"
          href={`${store.preferences.apiBaseUrl.replace(/\/$/, "")}/docs`}
          target="_blank"
          rel="noreferrer"
        >
          {pick("打开 API 文档", "Open API documentation")} <ExternalLink className="h-3 w-3" />
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
