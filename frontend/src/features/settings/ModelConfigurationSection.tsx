import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  CheckCircle2,
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
  { key: "teacher", label: "Teacher", description: "教学响应与引导" },
  { key: "extractor", label: "Extractor", description: "资料知识抽取" },
  { key: "grader", label: "Grader", description: "回答与掌握评估" },
  { key: "graph", label: "Graph", description: "图谱比较与建议" },
  { key: "vision", label: "Vision", description: "图片与扫描件理解" },
  { key: "embedding", label: "Embedding", description: "语义向量" },
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
    credentialStorage: "session",
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
  const [advanced, setAdvanced] = useState(false);
  const [unifiedModel, setUnifiedModel] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [configurationToken, setConfigurationToken] = useState("");
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
      setAvailableModels([]);
      setAdvanced(false);
      setUnifiedModel("");
      return;
    }
    const profile = profiles.find((item) => item.id === selectedId);
    if (!profile) return;
    setForm(formFromProfile(profile));
    setApiKey("");
    setAvailableModels([]);
    const values = roleModelValues(profile.models).filter(Boolean);
    const unified = values.length === 6 && new Set(values).size === 1;
    setAdvanced(!unified);
    setUnifiedModel(unified ? (values[0] ?? "") : "");
  }, [profiles, selectedId]);

  const refreshConfiguration = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.modelConfiguration }),
      queryClient.invalidateQueries({ queryKey: ["active-model"] }),
    ]);
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

  const saveMutation = useMutation({ mutationFn: persist });
  const discoverMutation = useMutation({
    mutationFn: async () => {
      const saved = await persist();
      return api.discoverProviderModels(saved.id);
    },
    onSuccess: (result) => setAvailableModels(result.models),
  });
  const testMutation = useMutation({
    mutationFn: async () => {
      const saved = await persist();
      return api.testModelConnection(saved.id);
    },
    onSuccess: async (result) => {
      setAvailableModels(result.models);
      await refreshConfiguration();
    },
    onError: refreshConfiguration,
  });
  const activateMutation = useMutation({
    mutationFn: async () => {
      const saved = await persist();
      return api.activateModelProfile(saved.id);
    },
    onSuccess: refreshConfiguration,
  });
  const deleteCredentialMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProfile) throw new Error("请先选择配置。");
      return api.deleteModelCredential(selectedProfile.id);
    },
    onSuccess: refreshConfiguration,
  });
  const deleteProfileMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProfile) throw new Error("请先选择配置。");
      await api.deleteModelProfile(selectedProfile.id);
    },
    onSuccess: async () => {
      setSelectedId(null);
      await refreshConfiguration();
    },
  });

  const mutationError = [
    saveMutation.error,
    discoverMutation.error,
    testMutation.error,
    activateMutation.error,
    deleteCredentialMutation.error,
    deleteProfileMutation.error,
  ].find((error) => error instanceof Error);
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
    setForm((current) => ({
      ...current,
      provider,
      name:
        provider === "mock"
          ? "Mock Provider"
          : provider === "siliconflow"
            ? "SiliconFlow"
            : "Custom Provider",
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
  };

  if (configuration.isLoading) {
    return (
      <section className="mb-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <p className="flex items-center gap-2 text-sm text-slate-500">
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
      className="mb-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
      aria-labelledby="model-configuration-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-[#3157D5]">LLM Gateway</p>
          <h2 id="model-configuration-heading" className="mt-1 text-lg font-semibold">
            模型与供应商
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            所有调用均由 KnowTier 后端 ModelGateway 执行。API Key 不会进入浏览器存储、URL 或普通配置文件。
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setSelectedId(NEW_PROFILE)}
        >
          <Plus className="h-4 w-4" /> 新建配置
        </button>
      </div>

      {active && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-800 dark:text-emerald-300">
            <ShieldCheck className="h-4 w-4" /> 当前启用：{active.name}
          </span>
          <span className="text-slate-600 dark:text-slate-300">
            Teacher · {active.provider} / {active.models.teacher}
          </span>
          <span className="text-xs text-slate-500">
            {active.connection_status === "connected"
              ? `最近测试 ${formatDate(active.last_tested_at)}`
              : "尚未成功测试连接"}
          </span>
        </div>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="模型配置" className="space-y-2">
          {profiles.map((profile) => (
            <button
              type="button"
              key={profile.id}
              onClick={() => setSelectedId(profile.id)}
              className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${selectedId === profile.id ? "border-[#3157D5] bg-indigo-50 dark:bg-indigo-950/40" : "border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"}`}
              aria-current={profile.active ? "true" : undefined}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{profile.name}</span>
                <ConnectionDot status={profile.connection_status} />
              </span>
              <span className="mt-1 block truncate text-xs text-slate-600 dark:text-slate-400">
                {providerLabel(profile.provider)}
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
                <option value="mock">Mock Provider（离线）</option>
                <option value="siliconflow">SiliconFlow</option>
                <option value="custom_openai_compatible">
                  Custom OpenAI-Compatible
                </option>
              </select>
            </Field>
          </div>

          {form.provider !== "mock" && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Base URL">
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
              <Field
                label="API Key"
                hint={
                  selectedProfile?.credential_present
                    ? `后端已保存：${selectedProfile.credential_masked}`
                    : "只发送到 KnowTier 后端"
                }
              >
                <input
                  className="form-input font-mono"
                  aria-label="API Key"
                  type="password"
                  autoComplete="new-password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    selectedProfile?.credential_present
                      ? "留空以保留现有凭据"
                      : "输入 API Key"
                  }
                />
              </Field>
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
                  <option value="session">仅本次后端会话</option>
                  <option value="os_keyring" disabled={!isDesktopRuntime()}>
                    操作系统凭据库{isDesktopRuntime() ? "（推荐）" : "（桌面端）"}
                  </option>
                </select>
              </Field>
              {form.provider === "custom_openai_compatible" && (
                <label className="flex items-center gap-2 self-end rounded-lg border border-slate-200 px-3 py-2.5 text-sm dark:border-slate-700">
                  <input
                    type="checkbox"
                    checked={form.allowLocal}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        allowLocal: event.target.checked,
                      }))
                    }
                  />
                  明确允许 localhost HTTP 供应商
                </label>
              )}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">角色模型映射</h3>
                <p className="mt-1 text-xs text-slate-500">
                  模型列表通过供应商 GET /models 动态发现。
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="quiet-button"
                  aria-pressed={!advanced}
                  onClick={() => setAdvanced(false)}
                >
                  统一模型
                </button>
                <button
                  type="button"
                  className="quiet-button"
                  aria-pressed={advanced}
                  onClick={() => setAdvanced(true)}
                >
                  高级映射
                </button>
              </div>
            </div>
            <datalist id="provider-model-options">
              {modelOptions.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            {!advanced ? (
              <Field label="所有角色使用">
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
                        teacher: model,
                        extractor: model,
                        grader: model,
                        graph: model,
                        vision: model,
                        embedding: model,
                      },
                    }));
                  }}
                  placeholder="先刷新模型，再搜索选择"
                />
              </Field>
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

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              label="Temperature"
              value={form.temperature}
              min={0}
              max={2}
              step={0.1}
              onChange={(temperature) =>
                setForm((current) => ({ ...current, temperature }))
              }
            />
            <NumberField
              label="Max Tokens"
              value={form.maxTokens}
              min={64}
              max={131072}
              step={64}
              onChange={(maxTokens) =>
                setForm((current) => ({ ...current, maxTokens }))
              }
            />
          </div>

          {(selectedProfile?.error_summary || mutationError) && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
              {mutationError instanceof Error
                ? mutationError.message
                : selectedProfile?.error_summary}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
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
              保存配置
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || form.provider === "mock"}
              onClick={() => discoverMutation.mutate()}
            >
              <RefreshCw className={`h-4 w-4 ${discoverMutation.isPending ? "animate-spin" : ""}`} />
              刷新模型
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || form.provider === "mock"}
              onClick={() => testMutation.mutate()}
            >
              <Wifi className="h-4 w-4" /> 测试连接
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || selectedProfile?.active === true}
              onClick={() => activateMutation.mutate()}
            >
              <CheckCircle2 className="h-4 w-4" /> 启用配置
            </button>
            {selectedProfile?.credential_present &&
              selectedProfile.provider !== "mock" && (
                <button
                  type="button"
                  className="secondary-button border-amber-200 text-amber-800"
                  disabled={busy}
                  onClick={() => deleteCredentialMutation.mutate()}
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
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
        {label}
        {hint && <span className="font-normal text-slate-500">{hint}</span>}
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
  return (
    <span
      title={
        status === "connected" ? "连接成功" : status === "error" ? "连接失败" : "未测试"
      }
      className={`h-2.5 w-2.5 shrink-0 rounded-full ${status === "connected" ? "bg-emerald-500" : status === "error" ? "bg-red-500" : "bg-slate-300"}`}
    />
  );
}

function providerLabel(provider: ModelProviderKind): string {
  if (provider === "mock") return "Mock Provider";
  if (provider === "siliconflow") return "SiliconFlow";
  return "Custom OpenAI-Compatible";
}

function formatDate(value: string | null): string {
  if (!value) return "从未";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
