import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Trash2,
  Wifi,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ErrorState } from "@/components/shared/States";
import { ApiError, UserFacingError } from "@/lib/api/errors";
import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { api } from "@/services/api";
import type {
  CredentialStorage,
  ModelProfile,
  ModelProfileInput,
  ModelProviderKind,
  RoleModels,
  UUID,
} from "@/types/api";
import { useI18n } from "@/lib/i18n";
import type { UiLocale } from "@/types/app";

const SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1";
const NEW_PROFILE = Symbol("new-profile");
const EMPTY_MODELS: RoleModels = {
  teacher: "",
  extractor: "",
  grader: "",
  graph: "",
  vision: "",
  embedding: "",
};

const ROLE_FIELDS: Array<{
  key: keyof RoleModels;
  label: string;
  description: string;
  labelEn: string;
  descriptionEn: string;
}> = [
  { key: "teacher", label: "教学模型", description: "回答问题与学习引导", labelEn: "Teaching model", descriptionEn: "Answers questions and guides learning" },
  { key: "extractor", label: "知识抽取模型", description: "从资料中提取知识", labelEn: "Extraction model", descriptionEn: "Extracts knowledge from materials" },
  { key: "grader", label: "学习评估模型", description: "评估回答与掌握程度", labelEn: "Grading model", descriptionEn: "Evaluates answers and mastery" },
  { key: "graph", label: "图谱模型", description: "比较图谱并生成建议", labelEn: "Graph model", descriptionEn: "Compares graphs and suggests changes" },
  { key: "vision", label: "图像理解模型", description: "理解图片与扫描件", labelEn: "Vision model", descriptionEn: "Understands images and scans" },
  { key: "embedding", label: "向量模型", description: "用于语义检索", labelEn: "Embedding model", descriptionEn: "Supports semantic retrieval" },
];
const GENERATION_ROLE_KEYS: Array<Exclude<keyof RoleModels, "embedding">> = [
  "teacher",
  "extractor",
  "grader",
  "graph",
  "vision",
];

interface ProfileForm {
  name: string;
  provider: ModelProviderKind;
  baseUrl: string;
  allowLocal: boolean;
  credentialStorage: CredentialStorage;
  models: RoleModels;
  timeoutSeconds: number;
  maxRetries: number;
  temperature: number;
  maxTokens: number;
}

function emptyForm(): ProfileForm {
  return {
    name: "SiliconFlow",
    provider: "siliconflow",
    baseUrl: SILICONFLOW_BASE_URL,
    allowLocal: false,
    credentialStorage: isDesktopRuntime() ? "os_keyring" : "session",
    models: { ...EMPTY_MODELS },
    timeoutSeconds: 30,
    maxRetries: 2,
    temperature: 0.2,
    maxTokens: 2048,
  };
}

function formFromProfile(profile: ModelProfile): ProfileForm {
  return {
    name: profile.name,
    provider: profile.provider,
    baseUrl: profile.base_url ?? "",
    allowLocal: profile.allow_local,
    credentialStorage: profile.credential_storage,
    models: { ...profile.models },
    timeoutSeconds: profile.timeout_seconds,
    maxRetries: profile.max_retries,
    temperature: profile.temperature,
    maxTokens: profile.max_tokens,
  };
}

function isDesktopRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function roleModelValues(models: RoleModels): string[] {
  return ROLE_FIELDS.map((role) => models[role.key]);
}

function defaultProfileName(provider: ModelProviderKind): string {
  if (provider === "mock") return "Mock Provider";
  if (provider === "siliconflow") return "SiliconFlow";
  return "Custom Provider";
}

function generationModelValues(models: RoleModels): string[] {
  return GENERATION_ROLE_KEYS.map((role) => models[role]);
}

function embeddingModelScore(model: string): number {
  const normalized = model.toLocaleLowerCase();
  if (
    ["rerank", "vl-embedding", "vision", "image", "audio", "speech"].some(
      (token) => normalized.includes(token),
    )
  ) {
    return -1;
  }
  const capability = ["embedding", "embed", "bge", "gte", "e5"].some(
    (token) => normalized.includes(token),
  );
  if (!capability) return -1;
  let score = 10;
  if (normalized.includes("qwen") && normalized.includes("embedding")) score += 5;
  if (normalized.includes("multilingual") || normalized.includes("m3")) score += 4;
  if (normalized.includes("zh")) score += 2;
  if (normalized.includes("embedding")) score += 1;
  return score;
}

function suggestedEmbeddingModel(models: string[]): string | undefined {
  return [...models]
    .filter((model) => embeddingModelScore(model) >= 0)
    .sort(
      (left, right) =>
        embeddingModelScore(right) - embeddingModelScore(left) ||
        left.localeCompare(right),
    )[0];
}

export function ModelConfigurationSection() {
  const { locale, pick } = useI18n();
  const queryClient = useQueryClient();
  const configuration = useQuery({
    queryKey: queryKeys.modelConfiguration,
    queryFn: ({ signal }) => api.getModelConfiguration(signal),
    retry: false,
  });
  const [selectedId, setSelectedId] = useState<UUID | typeof NEW_PROFILE | null>(
    null,
  );
  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [unifiedModel, setUnifiedModel] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [configurationToken, setConfigurationToken] = useState("");
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [hydratedSelection, setHydratedSelection] = useState<
    ModelProfile | typeof NEW_PROFILE | null
  >(null);
  const profiles = useMemo(
    () => configuration.data?.profiles ?? [],
    [configuration.data?.profiles],
  );

  useEffect(() => () => apiClient.setModelConfigurationToken(null), []);
  const selectedProfile = profiles.find((profile) => profile.id === selectedId);

  useEffect(() => {
    if (selectedId !== null) return;
    const initial =
      configuration.data?.active_profile_id ?? configuration.data?.profiles[0]?.id;
    if (initial) setSelectedId(initial);
  }, [configuration.data, selectedId]);

  useEffect(() => {
    if (selectedId === NEW_PROFILE) {
      setForm(emptyForm());
      setApiKey("");
      setShowApiKey(false);
      setAvailableModels([]);
      setAdvanced(false);
      setUnifiedModel("");
      setHydratedSelection(NEW_PROFILE);
      return;
    }
    const profile = profiles.find((item) => item.id === selectedId);
    if (!profile) return;
    setForm(formFromProfile(profile));
    setApiKey("");
    setShowApiKey(false);
    setAvailableModels([]);
    const values = generationModelValues(profile.models).filter(Boolean);
    const unified =
      values.length === 0 ||
      (values.length === GENERATION_ROLE_KEYS.length && new Set(values).size === 1);
    setAdvanced(!unified);
    setUnifiedModel(unified && values.length > 0 ? (values[0] ?? "") : "");
    setHydratedSelection(profile);
  }, [profiles, selectedId]);

  const refreshConfiguration = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.modelConfiguration }),
      queryClient.invalidateQueries({ queryKey: ["active-model"] }),
    ]);
  };

  const beginAction = () => {
    setActionFeedback(null);
    setActionError(null);
  };
  const recordActionError = (error: unknown) => {
    setActionError(error instanceof Error ? error : new UserFacingError(pick("模型配置操作失败。", "The model configuration action failed.")));
  };

  const persist = async (): Promise<ModelProfile> => {
    if (!form.name.trim()) throw new UserFacingError(pick("请输入配置名称。", "Enter a configuration name."));
    const input: ModelProfileInput = {
      name: form.name.trim(),
      provider: form.provider,
      base_url: form.provider === "mock" ? null : form.baseUrl.trim(),
      allow_local: form.allowLocal,
      credential_storage: form.credentialStorage,
      models: form.models,
      timeout_seconds: form.timeoutSeconds,
      max_retries: form.maxRetries,
      temperature: form.temperature,
      max_tokens: form.maxTokens,
      ...(apiKey ? { api_key: apiKey } : {}),
    };
    const saved =
      selectedId && selectedId !== NEW_PROFILE
        ? await api.updateModelProfile(selectedId, input)
        : await api.createModelProfile(input);
    setSelectedId(saved.id);
    setApiKey("");
    await refreshConfiguration();
    return saved;
  };

  const requireCredential = () => {
    if (
      form.provider !== "mock" &&
      !apiKey.trim() &&
      !selectedProfile?.credential_present
    ) {
      throw new UserFacingError(pick("请先输入 API Key，再刷新模型或测试连接。", "Enter an API key before refreshing models or testing the connection."));
    }
  };

  const requireModelAssignments = () => {
    const missing = ROLE_FIELDS.filter(
      (role) => !form.models[role.key].trim(),
    );
    if (missing.length > 0) {
      throw new UserFacingError(
        pick(
          `请先刷新模型，并完成模型用途配置：${missing.map((role) => role.label).join("、")}。`,
          `Refresh models and assign every role: ${missing.map((role) => role.labelEn).join(", ")}.`,
        ),
      );
    }
  };

  const saveMutation = useMutation({
    mutationFn: persist,
    onMutate: beginAction,
    onSuccess: () => setActionFeedback(pick("配置已安全保存。", "Configuration saved securely.")),
    onError: recordActionError,
  });
  const discoverMutation = useMutation({
    mutationFn: async () => {
      requireCredential();
      const saved = await persist();
      return api.discoverProviderModels(saved.id);
    },
    onSuccess: (result) => {
      setAvailableModels(result.models);
      setActionFeedback(pick(`已从供应商发现 ${result.models.length} 个可用模型。`, `Discovered ${result.models.length} available models.`));
      setForm((current) => {
        const currentEmbedding = current.models.embedding;
        const shouldSuggest =
          !currentEmbedding ||
          generationModelValues(current.models).includes(currentEmbedding);
        const suggestion = shouldSuggest
          ? suggestedEmbeddingModel(result.models)
          : undefined;
        return suggestion
          ? {
              ...current,
              models: { ...current.models, embedding: suggestion },
            }
          : current;
      });
    },
    onMutate: beginAction,
    onError: recordActionError,
  });
  const testMutation = useMutation({
    mutationFn: async () => {
      requireCredential();
      requireModelAssignments();
      const saved = await persist();
      return api.testModelConnection(saved.id);
    },
    onSuccess: async (result) => {
      setAvailableModels(result.models);
      await refreshConfiguration();
      setActionFeedback(pick(`连接测试成功，供应商返回 ${result.models.length} 个模型。`, `Connection succeeded. The provider returned ${result.models.length} models.`));
    },
    onMutate: beginAction,
    onError: async (error) => {
      recordActionError(error);
      await refreshConfiguration();
    },
  });
  const activateMutation = useMutation({
    mutationFn: async () => {
      requireCredential();
      requireModelAssignments();
      const saved = await persist();
      return api.activateModelProfile(saved.id);
    },
    onMutate: beginAction,
    onSuccess: async () => {
      await refreshConfiguration();
      setActionFeedback(pick("配置已启用，新的模型调用将使用此映射。", "Configuration enabled. New model calls will use this mapping."));
    },
    onError: recordActionError,
  });
  const deleteCredentialMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProfile) throw new UserFacingError(pick("请先选择配置。", "Select a configuration first."));
      return api.deleteModelCredential(selectedProfile.id);
    },
    onMutate: beginAction,
    onSuccess: async () => {
      setApiKey("");
      await refreshConfiguration();
      setActionFeedback(pick("已删除该配置保存的 API Key。", "Saved API key deleted."));
    },
    onError: recordActionError,
  });
  const deleteProfileMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProfile) throw new UserFacingError(pick("请先选择配置。", "Select a configuration first."));
      await api.deleteModelProfile(selectedProfile.id);
    },
    onMutate: beginAction,
    onSuccess: async () => {
      setSelectedId(null);
      await refreshConfiguration();
      setActionFeedback(pick("模型配置已删除。", "Model configuration deleted."));
    },
    onError: recordActionError,
  });

  const mutationError = actionError;
  const busy =
    saveMutation.isPending ||
    discoverMutation.isPending ||
    testMutation.isPending ||
    activateMutation.isPending ||
    deleteCredentialMutation.isPending ||
    deleteProfileMutation.isPending;
  const active = profiles.find((profile) => profile.active);
  const modelOptions = useMemo(
    () =>
      Array.from(new Set([...availableModels, ...roleModelValues(form.models)]))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
    [availableModels, form.models],
  );

  const setProvider = (provider: ModelProviderKind) => {
    beginAction();
    setForm((current) => ({
      ...current,
      provider,
      name:
        !current.name.trim() ||
        current.name.trim() === defaultProfileName(current.provider)
          ? defaultProfileName(provider)
          : current.name,
      baseUrl:
        provider === "siliconflow"
          ? SILICONFLOW_BASE_URL
          : provider === "mock"
            ? ""
            : current.provider === "custom_openai_compatible"
              ? current.baseUrl
              : "",
      allowLocal: provider === "custom_openai_compatible" && current.allowLocal,
      credentialStorage: provider === "mock" ? "session" : current.credentialStorage,
      models:
        provider === "mock"
          ? {
              teacher: "mock/default",
              extractor: "mock/default",
              grader: "mock/default",
              graph: "mock/default",
              vision: "mock/default",
              embedding: "mock/default",
            }
          : { ...EMPTY_MODELS },
    }));
    setUnifiedModel(provider === "mock" ? "mock/default" : "");
    setAdvanced(false);
    setAvailableModels([]);
    setApiKey("");
    setShowApiKey(false);
  };

  if (configuration.isLoading) {
    return (
      <section className="mb-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <p
          className="flex items-center gap-2 text-sm text-slate-500"
          role="status"
        >
          <LoaderCircle className="h-4 w-4 animate-spin" /> {pick("正在读取模型配置", "Loading model configuration")}
        </p>
      </section>
    );
  }
  // Do not expose a form until it has been hydrated for the exact profile
  // object selected from the latest query result. This covers both initial
  // selection and a refreshed profile with the same id; otherwise a quick edit
  // can be overwritten by the hydration effect a moment later.
  const selectionIsHydrating =
    (selectedId === null && profiles.length > 0) ||
    (selectedId === NEW_PROFILE
      ? hydratedSelection !== NEW_PROFILE
      : selectedProfile !== undefined && hydratedSelection !== selectedProfile);
  if (selectionIsHydrating) {
    return (
      <section className="mb-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <p
          className="flex items-center gap-2 text-sm text-slate-500"
          role="status"
        >
          <LoaderCircle className="h-4 w-4 animate-spin" />{" "}
          {pick("正在准备模型配置", "Preparing model configuration")}
        </p>
      </section>
    );
  }
  if (configuration.isError) {
    const requiresAdminToken =
      configuration.error instanceof ApiError &&
      (configuration.error.status === 401 || configuration.error.status === 503);
    return (
      <section className="mb-5">
        <ErrorState
          error={configuration.error}
          onRetry={() => void configuration.refetch()}
        />
        {requiresAdminToken && (
          <form
            className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30"
            onSubmit={(event) => {
              event.preventDefault();
              apiClient.setModelConfigurationToken(configurationToken);
              void configuration.refetch();
            }}
          >
            <label className="block text-sm font-medium" htmlFor="model-admin-token">
              {pick("管理员配置令牌", "Administrator configuration token")}
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                id="model-admin-token"
                className="form-input min-w-[16rem] flex-1 font-mono"
                type="password"
                autoComplete="new-password"
                value={configurationToken}
                onChange={(event) => setConfigurationToken(event.target.value)}
                placeholder={pick("仅保存在当前页面会话", "Kept only for this page session")}
              />
              <button type="submit" className="primary-button">
                {pick("验证并读取配置", "Verify and load configuration")}
              </button>
            </div>
          </form>
        )}
      </section>
    );
  }

  return (
    <section
      className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none sm:p-5"
      aria-labelledby="model-configuration-heading"
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-[#3157D5]">{pick("统一模型网关", "Unified model gateway")}</p>
          <h2 id="model-configuration-heading" className="mt-1 text-lg font-semibold">
            {pick("模型与供应商", "Models and providers")}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            {pick(
              "所有模型调用都由 KnowTier 服务统一执行。API Key 不会进入浏览器存储、网址或普通配置文件。",
              "KnowTier runs every model call through its backend service. API keys never enter browser storage, URLs, or ordinary configuration files.",
            )}
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            beginAction();
            setSelectedId(NEW_PROFILE);
          }}
        >
          <Plus className="h-4 w-4" /> {pick("新建配置", "New configuration")}
        </button>
      </div>

      {active && (
        <div
          className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30"
          aria-live="polite"
        >
          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-800 dark:text-emerald-300">
            <ShieldCheck className="h-4 w-4" />{" "}
            {pick(`当前启用：${active.name}`, `Active: ${active.name}`)}
          </span>
          <span className="text-slate-600 dark:text-slate-300">
            {pick("教学模型", "Teaching model")} · {providerLabel(active.provider, locale)} / {active.models.teacher || pick("未配置", "Not configured")}
          </span>
          <span className="text-xs text-slate-500">
            {active.connection_status === "connected"
              ? pick(`最近测试 ${formatDate(active.last_tested_at, locale)}`, `Last tested ${formatDate(active.last_tested_at, locale)}`)
              : pick("尚未成功测试连接", "Connection not tested successfully yet")}
          </span>
        </div>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
        <nav
          aria-label={pick("模型配置", "Model configurations")}
          className="grid gap-2 sm:grid-cols-2 xl:block xl:space-y-2"
        >
          {profiles.map((profile) => (
            <button
              type="button"
              key={profile.id}
              onClick={() => {
                beginAction();
                setSelectedId(profile.id);
              }}
              className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${selectedId === profile.id ? "border-[#3157D5] bg-indigo-50 dark:bg-indigo-950/40" : "border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"}`}
              aria-current={profile.active ? "true" : undefined}
              aria-pressed={selectedId === profile.id}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{profile.name}</span>
                <ConnectionDot status={effectiveConnectionStatus(profile)} />
              </span>
              <span className="mt-1 block truncate text-xs text-slate-600 dark:text-slate-400">
                {providerLabel(profile.provider, locale)}
                {profile.provider !== "mock" && !profile.credential_present
                  ? pick(" · 未添加密钥", " · No API key")
                  : ""}
              </span>
            </button>
          ))}
          {selectedId === NEW_PROFILE && (
            <div className="rounded-lg border border-dashed border-[#3157D5] bg-indigo-50 px-3 py-3 text-sm font-medium text-[#3157D5] dark:bg-indigo-950/40">
              {pick("新配置", "New configuration")}
            </div>
          )}
        </nav>

        <div className="min-w-0 space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={pick("配置名称", "Configuration name")}>
              <input
                className="form-input"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                required
              />
            </Field>
            <Field label={pick("供应商", "Provider")}>
              <select
                className="form-input"
                value={form.provider}
                onChange={(event) =>
                  setProvider(event.target.value as ModelProviderKind)
                }
              >
                <option value="mock">{pick("离线模拟（Mock）", "Offline mock")}</option>
                <option value="siliconflow">SiliconFlow</option>
                <option value="custom_openai_compatible">
                  {pick("自定义 OpenAI 兼容接口", "Custom OpenAI-compatible")}
                </option>
              </select>
            </Field>
          </div>

          {form.provider !== "mock" && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={pick("服务地址（Base URL）", "Service address (Base URL)")}>
                <input
                  className="form-input font-mono text-xs"
                  value={form.baseUrl}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      baseUrl: event.target.value,
                    }))
                  }
                  placeholder={SILICONFLOW_BASE_URL}
                  inputMode="url"
                />
              </Field>
              <div className="mt-3 block space-y-1.5">
                <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1 text-xs">
                  <label
                    htmlFor="model-api-key"
                    className="font-medium text-slate-600 dark:text-slate-300"
                  >
                    API Key
                  </label>
                  <span
                    id="model-api-key-state"
                    className="break-all text-right text-slate-500"
                  >
                    {selectedProfile?.credential_present
                      ? pick(`已安全保存：${selectedProfile.credential_masked ?? "••••••••"}`, `Saved securely: ${selectedProfile.credential_masked ?? "••••••••"}`)
                      : pick("只发送到 KnowTier 服务", "Sent only to the KnowTier service")}
                  </span>
                </div>
                <div className="relative">
                  <input
                    id="model-api-key"
                    className="form-input pr-12 font-mono"
                    aria-describedby="model-api-key-state model-api-key-safety"
                    type={showApiKey ? "text" : "password"}
                    autoComplete="new-password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={
                      selectedProfile?.credential_present
                        ? pick("留空以保留现有凭据", "Leave blank to keep the saved credential")
                        : pick("输入 API Key", "Enter API key")
                    }
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-1 my-auto inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#3157D5]/40 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                    onClick={() => setShowApiKey((visible) => !visible)}
                    aria-label={showApiKey ? pick("隐藏密钥内容", "Hide API key") : pick("显示密钥内容", "Show API key")}
                    aria-pressed={showApiKey}
                  >
                    {showApiKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <span id="model-api-key-safety" className="sr-only">
                  {pick("默认遮蔽。密钥只发送给 KnowTier 服务，不会写入浏览器本地存储。", "Masked by default. The key is sent only to KnowTier and is never written to browser storage.")}
                </span>
              </div>
              <Field label={pick("凭据保存方式", "Credential storage")}>
                <select
                  className="form-input"
                  value={form.credentialStorage}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      credentialStorage: event.target.value as CredentialStorage,
                    }))
                  }
                >
                  <option value="session">{pick("仅本次应用会话", "This app session only")}</option>
                  <option value="os_keyring" disabled={!isDesktopRuntime()}>
                    {pick("操作系统凭据库", "Operating-system credential vault")}{isDesktopRuntime() ? pick("（推荐）", " (recommended)") : pick("（桌面端）", " (desktop only)")}
                  </option>
                </select>
              </Field>
              {form.provider === "custom_openai_compatible" && (
                <label className="flex items-start gap-2 self-end rounded-lg border border-slate-200 px-3 py-2.5 text-sm dark:border-slate-700">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={form.allowLocal}
                    aria-describedby="allow-local-provider-help"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        allowLocal: event.target.checked,
                      }))
                    }
                  />
                  <span>
                    {pick("允许本机 HTTP 模型服务", "Allow a local HTTP model service")}
                    <span
                      id="allow-local-provider-help"
                      className="mt-0.5 block text-[11px] leading-4 text-slate-500"
                    >
                      {pick("仅用于本机开发服务；其他地址仍必须使用 HTTPS。", "Use this only for a local service. All other addresses must use HTTPS.")}
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{pick("模型用途分配", "Model role assignment")}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {pick("模型列表从供应商实时获取，不绑定固定型号。", "The model list is loaded live from the provider; no model IDs are hard-coded.")}
                  {availableModels.length > 0 && pick(` 已加载 ${availableModels.length} 个模型。`, ` ${availableModels.length} models loaded.`)}
                </p>
                {form.provider !== "mock" && (
                  <p className="mt-1 text-[11px] leading-5 text-slate-500">
                    {pick("“刷新模型”“测试连接”和“启用配置”都会先安全保存当前表单。", "Refresh, connection test, and activation securely save the current form first.")}
                  </p>
                )}
              </div>
              <div className="flex gap-2" role="group" aria-label={pick("模型分配方式", "Model assignment mode")}>
                <button
                  type="button"
                  className="quiet-button"
                  aria-pressed={!advanced}
                  onClick={() => setAdvanced(false)}
                >
                  {pick("快速配置", "Quick setup")}
                </button>
                <button
                  type="button"
                  className="quiet-button"
                  aria-pressed={advanced}
                  onClick={() => setAdvanced(true)}
                >
                  {pick("按用途配置", "Assign by role")}
                </button>
              </div>
            </div>
            <datalist id="provider-model-options">
              {modelOptions.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            {!advanced ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Field
                  label={pick("统一生成模型", "Generation model")}
                  hint={pick("用于教学、抽取、评估、图谱和图像理解", "Used for teaching, extraction, grading, graph analysis, and vision")}
                >
                  <input
                    className="form-input font-mono text-xs"
                    list="provider-model-options"
                    value={unifiedModel}
                    onChange={(event) => {
                      const model = event.target.value;
                      setUnifiedModel(model);
                      setForm((current) => ({
                        ...current,
                        models: {
                          ...current.models,
                          teacher: model,
                          extractor: model,
                          grader: model,
                          graph: model,
                          vision: model,
                        },
                      }));
                    }}
                    placeholder={pick("先刷新模型，再搜索选择", "Refresh models, then search and select")}
                  />
                </Field>
                <Field label={pick("向量模型", "Embedding model")} hint={pick("需支持 Embeddings 接口", "Must support the embeddings endpoint")}>
                  <input
                    className="form-input font-mono text-xs"
                    list="provider-model-options"
                    value={form.models.embedding}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        models: {
                          ...current.models,
                          embedding: event.target.value,
                        },
                      }))
                    }
                    placeholder={pick("刷新后自动建议，也可搜索选择", "Suggested after refresh, or search and select")}
                  />
                </Field>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {ROLE_FIELDS.map((role) => (
                  <Field
                    key={role.key}
                    label={locale === "en" ? role.labelEn : role.label}
                    hint={locale === "en" ? role.descriptionEn : role.description}
                  >
                    <input
                      className="form-input font-mono text-xs"
                      list="provider-model-options"
                      value={form.models[role.key]}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          models: {
                            ...current.models,
                            [role.key]: event.target.value,
                          },
                        }))
                      }
                      placeholder={pick("搜索模型", "Search models")}
                    />
                  </Field>
                ))}
              </div>
            )}
          </div>

          <details className="rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-800">
            <summary className="cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-300">
              {pick("生成参数（高级）", "Generation parameters (advanced)")}
            </summary>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              {pick("默认值适合大多数情况；仅在响应过慢、输出过长或需要调整随机性时修改。", "The defaults suit most cases. Adjust them only for slow responses, overly long output, or creativity control.")}
            </p>
            <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <NumberField
                label={pick("超时（秒）", "Timeout (seconds)")}
                value={form.timeoutSeconds}
                min={1}
                max={300}
                step={1}
                onChange={(timeoutSeconds) =>
                  setForm((current) => ({ ...current, timeoutSeconds }))
                }
              />
              <NumberField
                label={pick("重试次数", "Retries")}
                value={form.maxRetries}
                min={0}
                max={5}
                step={1}
                onChange={(maxRetries) =>
                  setForm((current) => ({ ...current, maxRetries }))
                }
              />
              <NumberField
                label={pick("回答随机性（Temperature）", "Response randomness (Temperature)")}
                value={form.temperature}
                min={0}
                max={2}
                step={0.1}
                onChange={(temperature) =>
                  setForm((current) => ({ ...current, temperature }))
                }
              />
              <NumberField
                label={pick("最长输出（Tokens）", "Maximum output (tokens)")}
                value={form.maxTokens}
                min={64}
                max={131072}
                step={64}
                onChange={(maxTokens) =>
                  setForm((current) => ({ ...current, maxTokens }))
                }
              />
            </div>
          </details>

          {(selectedProfile?.error_summary || mutationError) && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              {mutationError instanceof Error
                ? mutationError.message
                : selectedProfile?.error_summary}
            </div>
          )}
          {actionFeedback && !mutationError && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {actionFeedback}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <ServerCog className="h-4 w-4" />
              )}
              {saveMutation.isPending ? pick("正在保存", "Saving") : pick("保存配置", "Save configuration")}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || form.provider === "mock"}
              onClick={() => discoverMutation.mutate()}
            >
              <RefreshCw className={`h-4 w-4 ${discoverMutation.isPending ? "animate-spin" : ""}`} />
              {discoverMutation.isPending ? pick("正在刷新", "Refreshing") : pick("刷新模型", "Refresh models")}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => testMutation.mutate()}
            >
              {testMutation.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Wifi className="h-4 w-4" />
              )}
              {testMutation.isPending ? pick("正在测试", "Testing") : pick("测试连接", "Test connection")}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || selectedProfile?.active === true}
              onClick={() => activateMutation.mutate()}
            >
              <CheckCircle2 className="h-4 w-4" /> {pick("启用配置", "Enable configuration")}
            </button>
          </div>
          {((selectedProfile?.credential_present &&
            selectedProfile.provider !== "mock") ||
            (selectedProfile && !selectedProfile.active)) && (
            <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  {pick("安全维护", "Secure maintenance")}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {pick("删除操作不会显示或返回已保存的 API Key。", "Delete actions never display or return the saved API key.")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedProfile?.credential_present &&
                  selectedProfile.provider !== "mock" && (
                    <button
                      type="button"
                      className="secondary-button border-amber-200 text-amber-800"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            pick(`删除模型配置“${selectedProfile.name}”保存的 API Key？`, `Delete the API key saved for “${selectedProfile.name}”?`),
                          )
                        ) {
                          deleteCredentialMutation.mutate();
                        }
                      }}
                    >
                      <KeyRound className="h-4 w-4" /> {pick("删除凭据", "Delete credential")}
                    </button>
                  )}
                {selectedProfile && !selectedProfile.active && (
                <button
                  type="button"
                  className="secondary-button border-red-200 text-red-700"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(pick(`删除模型配置“${selectedProfile.name}”？`, `Delete model configuration “${selectedProfile.name}”?`))) {
                      deleteProfileMutation.mutate();
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" /> {pick("删除配置", "Delete configuration")}
                </button>
              )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-3 block space-y-1.5">
      <span className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1 text-xs font-medium text-slate-600 dark:text-slate-300">
        {label}
        {hint && (
          <span className="break-all text-right font-normal text-slate-500">
            {hint}
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        className="form-input"
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}

function ConnectionDot({
  status,
}: {
  status: ModelProfile["connection_status"];
}) {
  const { pick } = useI18n();
  const label =
    status === "connected"
      ? pick("连接成功", "Connected")
      : status === "error"
        ? pick("连接失败", "Connection failed")
        : pick("未测试", "Not tested");
  return (
    <span
      title={label}
      className="inline-flex shrink-0 items-center"
    >
      <span
        aria-hidden="true"
        className={`h-2.5 w-2.5 rounded-full ${status === "connected" ? "bg-emerald-500" : status === "error" ? "bg-red-500" : "bg-slate-300"}`}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function effectiveConnectionStatus(
  profile: ModelProfile,
): ModelProfile["connection_status"] {
  if (profile.provider !== "mock" && !profile.credential_present) {
    return "untested";
  }
  return profile.connection_status;
}

function providerLabel(provider: ModelProviderKind, locale: UiLocale = "zh-CN"): string {
  if (provider === "mock") return locale === "en" ? "Offline mock" : "离线模拟（Mock）";
  if (provider === "siliconflow") return "SiliconFlow";
  return locale === "en" ? "Custom OpenAI-compatible" : "自定义 OpenAI 兼容接口";
}

function formatDate(
  value: string | null,
  locale: UiLocale = "zh-CN",
): string {
  if (!value) return locale === "en" ? "Never" : "从未";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return locale === "en" ? "Time unavailable" : "时间不可用";
  return new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}
