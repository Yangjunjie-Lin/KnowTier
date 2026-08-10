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
import { ApiError } from "@/lib/api/errors";
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
}> = [
  { key: "teacher", label: "教学模型", description: "回答问题与学习引导" },
  { key: "extractor", label: "知识抽取模型", description: "从资料中提取知识" },
  { key: "grader", label: "学习评估模型", description: "评估回答与掌握程度" },
  { key: "graph", label: "图谱模型", description: "比较图谱并生成建议" },
  { key: "vision", label: "图像理解模型", description: "理解图片与扫描件" },
  { key: "embedding", label: "向量模型", description: "用于语义检索" },
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
    setActionError(error instanceof Error ? error : new Error("模型配置操作失败。"));
  };

  const persist = async (): Promise<ModelProfile> => {
    if (!form.name.trim()) throw new Error("请输入配置名称。");
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
      throw new Error("请先输入 API Key，再刷新模型或测试连接。");
    }
  };

  const requireModelAssignments = () => {
    const missing = ROLE_FIELDS.filter(
      (role) => !form.models[role.key].trim(),
    );
    if (missing.length > 0) {
      throw new Error(
        `请先刷新模型，并完成模型用途配置：${missing.map((role) => role.label).join("、")}。`,
      );
    }
  };

  const saveMutation = useMutation({
    mutationFn: persist,
    onMutate: beginAction,
    onSuccess: () => setActionFeedback("配置已安全保存。"),
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
      setActionFeedback(`已从供应商发现 ${result.models.length} 个可用模型。`);
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
      setActionFeedback(`连接测试成功，供应商返回 ${result.models.length} 个模型。`);
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
      setActionFeedback("配置已启用，新的模型调用将使用此映射。");
    },
    onError: recordActionError,
  });
  const deleteCredentialMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProfile) throw new Error("请先选择配置。");
      return api.deleteModelCredential(selectedProfile.id);
    },
    onMutate: beginAction,
    onSuccess: async () => {
      setApiKey("");
      await refreshConfiguration();
      setActionFeedback("已删除该配置保存的 API Key。");
    },
    onError: recordActionError,
  });
  const deleteProfileMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProfile) throw new Error("请先选择配置。");
      await api.deleteModelProfile(selectedProfile.id);
    },
    onMutate: beginAction,
    onSuccess: async () => {
      setSelectedId(null);
      await refreshConfiguration();
      setActionFeedback("模型配置已删除。");
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
          <LoaderCircle className="h-4 w-4 animate-spin" /> 正在读取模型配置
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
              管理员配置令牌
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                id="model-admin-token"
                className="form-input min-w-[16rem] flex-1 font-mono"
                type="password"
                autoComplete="new-password"
                value={configurationToken}
                onChange={(event) => setConfigurationToken(event.target.value)}
                placeholder="仅保存在当前页面会话"
              />
              <button type="submit" className="primary-button">
                验证并读取配置
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
          <p className="text-xs font-medium text-[#3157D5]">统一模型网关</p>
          <h2 id="model-configuration-heading" className="mt-1 text-lg font-semibold">
            模型与供应商
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            所有模型调用都由 KnowTier 服务统一执行。API Key 不会进入浏览器存储、网址或普通配置文件。
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
          <Plus className="h-4 w-4" /> 新建配置
        </button>
      </div>

      {active && (
        <div
          className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30"
          aria-live="polite"
        >
          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-800 dark:text-emerald-300">
            <ShieldCheck className="h-4 w-4" /> 当前启用：{active.name}
          </span>
          <span className="text-slate-600 dark:text-slate-300">
            教学模型 · {providerLabel(active.provider)} / {active.models.teacher || "未配置"}
          </span>
          <span className="text-xs text-slate-500">
            {active.connection_status === "connected"
              ? `最近测试 ${formatDate(active.last_tested_at)}`
              : "尚未成功测试连接"}
          </span>
        </div>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
        <nav
          aria-label="模型配置"
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
                {providerLabel(profile.provider)}
                {profile.provider !== "mock" && !profile.credential_present
                  ? " · 未添加密钥"
                  : ""}
              </span>
            </button>
          ))}
          {selectedId === NEW_PROFILE && (
            <div className="rounded-lg border border-dashed border-[#3157D5] bg-indigo-50 px-3 py-3 text-sm font-medium text-[#3157D5] dark:bg-indigo-950/40">
              新配置
            </div>
          )}
        </nav>

        <div className="min-w-0 space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="配置名称">
              <input
                className="form-input"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                required
              />
            </Field>
            <Field label="供应商">
              <select
                className="form-input"
                value={form.provider}
                onChange={(event) =>
                  setProvider(event.target.value as ModelProviderKind)
                }
              >
                <option value="mock">离线模拟（Mock）</option>
                <option value="siliconflow">SiliconFlow</option>
                <option value="custom_openai_compatible">
                  自定义 OpenAI 兼容接口
                </option>
              </select>
            </Field>
          </div>

          {form.provider !== "mock" && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="服务地址（Base URL）">
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
                      ? `已安全保存：${selectedProfile.credential_masked ?? "••••••••"}`
                      : "只发送到 KnowTier 服务"}
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
                        ? "留空以保留现有凭据"
                        : "输入 API Key"
                    }
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-1 my-auto inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#3157D5]/40 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                    onClick={() => setShowApiKey((visible) => !visible)}
                    aria-label={showApiKey ? "隐藏密钥内容" : "显示密钥内容"}
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
                  默认遮蔽。密钥只发送给 KnowTier 服务，不会写入浏览器本地存储。
                </span>
              </div>
              <Field label="凭据保存方式">
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
                  <option value="session">仅本次应用会话</option>
                  <option value="os_keyring" disabled={!isDesktopRuntime()}>
                    操作系统凭据库{isDesktopRuntime() ? "（推荐）" : "（桌面端）"}
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
                    允许本机 HTTP 模型服务
                    <span
                      id="allow-local-provider-help"
                      className="mt-0.5 block text-[11px] leading-4 text-slate-500"
                    >
                      仅用于本机开发服务；其他地址仍必须使用 HTTPS。
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">模型用途分配</h3>
                <p className="mt-1 text-xs text-slate-500">
                  模型列表从供应商实时获取，不绑定固定型号。
                  {availableModels.length > 0 && ` 已加载 ${availableModels.length} 个模型。`}
                </p>
                {form.provider !== "mock" && (
                  <p className="mt-1 text-[11px] leading-5 text-slate-500">
                    “刷新模型”“测试连接”和“启用配置”都会先安全保存当前表单。
                  </p>
                )}
              </div>
              <div className="flex gap-2" role="group" aria-label="模型分配方式">
                <button
                  type="button"
                  className="quiet-button"
                  aria-pressed={!advanced}
                  onClick={() => setAdvanced(false)}
                >
                  快速配置
                </button>
                <button
                  type="button"
                  className="quiet-button"
                  aria-pressed={advanced}
                  onClick={() => setAdvanced(true)}
                >
                  按用途配置
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
                  label="统一生成模型"
                  hint="用于教学、抽取、评估、图谱和图像理解"
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
                    placeholder="先刷新模型，再搜索选择"
                  />
                </Field>
                <Field label="向量模型" hint="需支持 Embeddings 接口">
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
                    placeholder="刷新后自动建议，也可搜索选择"
                  />
                </Field>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {ROLE_FIELDS.map((role) => (
                  <Field key={role.key} label={role.label} hint={role.description}>
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
                      placeholder="搜索模型"
                    />
                  </Field>
                ))}
              </div>
            )}
          </div>

          <details className="rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-800">
            <summary className="cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-300">
              生成参数（高级）
            </summary>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              默认值适合大多数情况；仅在响应过慢、输出过长或需要调整随机性时修改。
            </p>
            <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <NumberField
                label="超时（秒）"
                value={form.timeoutSeconds}
                min={1}
                max={300}
                step={1}
                onChange={(timeoutSeconds) =>
                  setForm((current) => ({ ...current, timeoutSeconds }))
                }
              />
              <NumberField
                label="重试次数"
                value={form.maxRetries}
                min={0}
                max={5}
                step={1}
                onChange={(maxRetries) =>
                  setForm((current) => ({ ...current, maxRetries }))
                }
              />
              <NumberField
                label="回答随机性（Temperature）"
                value={form.temperature}
                min={0}
                max={2}
                step={0.1}
                onChange={(temperature) =>
                  setForm((current) => ({ ...current, temperature }))
                }
              />
              <NumberField
                label="最长输出（Tokens）"
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
              {saveMutation.isPending ? "正在保存" : "保存配置"}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || form.provider === "mock"}
              onClick={() => discoverMutation.mutate()}
            >
              <RefreshCw className={`h-4 w-4 ${discoverMutation.isPending ? "animate-spin" : ""}`} />
              {discoverMutation.isPending ? "正在刷新" : "刷新模型"}
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
              {testMutation.isPending ? "正在测试" : "测试连接"}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || selectedProfile?.active === true}
              onClick={() => activateMutation.mutate()}
            >
              <CheckCircle2 className="h-4 w-4" /> 启用配置
            </button>
          </div>
          {((selectedProfile?.credential_present &&
            selectedProfile.provider !== "mock") ||
            (selectedProfile && !selectedProfile.active)) && (
            <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  安全维护
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  删除操作不会显示或返回已保存的 API Key。
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
                            `删除模型配置“${selectedProfile.name}”保存的 API Key？`,
                          )
                        ) {
                          deleteCredentialMutation.mutate();
                        }
                      }}
                    >
                      <KeyRound className="h-4 w-4" /> 删除凭据
                    </button>
                  )}
                {selectedProfile && !selectedProfile.active && (
                <button
                  type="button"
                  className="secondary-button border-red-200 text-red-700"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`删除模型配置“${selectedProfile.name}”？`)) {
                      deleteProfileMutation.mutate();
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" /> 删除配置
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
  const label =
    status === "connected" ? "连接成功" : status === "error" ? "连接失败" : "未测试";
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

function providerLabel(provider: ModelProviderKind): string {
  if (provider === "mock") return "离线模拟（Mock）";
  if (provider === "siliconflow") return "SiliconFlow";
  return "自定义 OpenAI 兼容接口";
}

function formatDate(value: string | null): string {
  if (!value) return "从未";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "时间不可用";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}
