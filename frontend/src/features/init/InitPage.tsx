import { zodResolver } from "@hookform/resolvers/zod";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  KeyRound,
  Languages,
  LoaderCircle,
  Plus,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { flushSync } from "react-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { api } from "@/services/api";
import { ApiError, UserFacingError, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/queryKeys";
import { isUuid } from "@/lib/utils";
import { useAppStore } from "@/stores/AppContext";
import { ErrorState } from "@/components/shared/States";
import { useI18n } from "@/lib/i18n";
import type { Learner, Workspace } from "@/types/api";

const workspaceSchema = z.object({
  name: z.string().trim().min(1, "请输入学习主题 / Enter a learning topic").max(200),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "空间标识只能使用小写字母、数字和连字符 / Use lowercase letters, numbers, and hyphens"),
  default_language: z.string().min(2),
  provisioningToken: z.string().optional(),
});
const learnerSchema = z.object({
  display_name: z.string().trim().min(1, "请输入希望使用的称呼 / Enter the name you want to use").max(200),
  language: z.string().min(2),
});
type WorkspaceValues = z.infer<typeof workspaceSchema>;
type LearnerValues = z.infer<typeof learnerSchema>;

function workspaceSlugFromName(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
  if (normalized) return normalized;
  const trimmed = name.trim();
  if (!trimmed) return "";
  let hash = 2_166_136_261;
  for (const character of trimmed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `study-${(hash >>> 0).toString(36)}`;
}

function mergeById<T extends { id: string }>(
  primary: readonly T[],
  fallback: readonly T[],
): T[] {
  const seen = new Set<string>();
  return [...primary, ...fallback].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function InitPage() {
  const { locale, setLocale, pick, t } = useI18n();
  const navigate = useNavigate();
  const {
    currentWorkspace,
    currentLearner,
    recentWorkspaces,
    recentLearners,
    setWorkspace,
    setLearner,
  } = useAppStore();
  const [step, setStep] = useState<"workspace" | "learner">("workspace");
  const [existingWorkspaceId, setExistingWorkspaceId] = useState(
    currentWorkspace?.id ?? "",
  );
  const [existingLearnerId, setExistingLearnerId] = useState(
    currentLearner?.id ?? "",
  );
  const [learnerMode, setLearnerMode] = useState<"create" | "existing">(
    "create",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title =
      locale === "en" ? "Set up learning · KnowTier" : "设置学习 · KnowTier";
  }, [locale]);
  useEffect(() => {
    const focusFrame = window.requestAnimationFrame(() =>
      headingRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(focusFrame);
  }, []);
  const workspacesQuery = useInfiniteQuery({
    queryKey: queryKeys.workspaces,
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      api.listWorkspaces(signal, pageParam),
    getNextPageParam: (lastPage) => lastPage.next_offset ?? undefined,
    staleTime: 30_000,
  });
  const learnersQuery = useInfiniteQuery({
    queryKey: queryKeys.learners(currentWorkspace?.id ?? "none"),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      api.listLearners(currentWorkspace!.id, signal, pageParam),
    getNextPageParam: (lastPage) => lastPage.next_offset ?? undefined,
    enabled: step === "learner" && Boolean(currentWorkspace),
    staleTime: 30_000,
  });
  const availableWorkspaces = useMemo(
    () =>
      mergeById(
        workspacesQuery.data?.pages.flatMap((page) => page.items) ?? [],
        recentWorkspaces,
      ),
    [recentWorkspaces, workspacesQuery.data?.pages],
  );
  const availableLearners = useMemo(
    () =>
      mergeById(
        learnersQuery.data?.pages.flatMap((page) => page.items) ?? [],
        recentLearners.filter(
          (learner) => learner.workspace_id === currentWorkspace?.id,
        ),
      ),
    [currentWorkspace?.id, learnersQuery.data?.pages, recentLearners],
  );
  const workspaceForm = useForm<WorkspaceValues>({
    resolver: zodResolver(workspaceSchema),
    defaultValues: {
      name: "",
      slug: "",
      default_language: "zh-CN",
      provisioningToken: "",
    },
  });
  const learnerForm = useForm<LearnerValues>({
    resolver: zodResolver(learnerSchema),
    defaultValues: { display_name: "", language: "zh-CN" },
  });

  const handleWorkspace = async (values: WorkspaceValues) => {
    setBusy(true);
    setError(null);
    try {
      const workspace = await api.createWorkspace(values);
      setWorkspace(workspace);
      learnerForm.setValue("language", workspace.default_language);
      workspaceForm.setValue("provisioningToken", "");
      setLearnerMode("create");
      setStep("learner");
    } catch (requestError) {
      if (isApiError(requestError) && requestError.status === 409) {
        setError(
          new UserFacingError(
            pick(
              "这个主题标识已经被使用。请从已有主题中选择，或在“高级设置”中换一个空间标识。",
              "This topic identifier is already in use. Choose the saved topic above, or change the workspace identifier in Advanced settings.",
            ),
          ),
        );
        void workspacesQuery.refetch();
      } else {
        setError(requestError);
      }
    } finally {
      setBusy(false);
    }
  };

  const connectExistingWorkspace = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const workspace = await api.getWorkspace(id);
      setWorkspace(workspace);
      learnerForm.setValue("language", workspace.default_language);
      setLearnerMode("existing");
      setStep("learner");
    } catch (requestError) {
      setError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const useKnownWorkspace = (workspace: Workspace) => {
    setError(null);
    setWorkspace(workspace);
    learnerForm.setValue("language", workspace.default_language);
    setLearnerMode("existing");
    setStep("learner");
  };

  const chooseExistingWorkspace = () => {
    const id = existingWorkspaceId.trim();
    if (!isUuid(id)) {
      setError(new UserFacingError(pick("请输入有效的学习空间标识。", "Enter a valid workspace identifier.")));
      return;
    }
    void connectExistingWorkspace(id);
  };

  const handleLearner = async (values: LearnerValues) => {
    if (!currentWorkspace) {
      setError(new UserFacingError(pick("请先选择学习空间。", "Select a workspace first.")));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const learner = await api.createLearner({
        workspace_id: currentWorkspace.id,
        ...values,
      });
      flushSync(() => setLearner(learner));
      void navigate("/overview");
    } catch (requestError) {
      setError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const verifyExistingLearner = async (id = existingLearnerId) => {
    const learnerId = id.trim();
    if (!currentWorkspace || !isUuid(learnerId)) {
      setError(new UserFacingError(pick("请输入有效的学习者标识。", "Enter a valid learner identifier.")));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const learner = await api.getLearner(learnerId);
      if (learner.workspace_id !== currentWorkspace.id)
        throw new ApiError({
          message: pick("该学习者不属于当前学习空间。", "This learner does not belong to the current workspace."),
          status: 403,
          kind: "forbidden",
        });
      flushSync(() => setLearner(learner));
      void navigate("/overview");
    } catch (requestError) {
      setError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const useKnownLearner = (learner: Learner) => {
    if (!currentWorkspace || learner.workspace_id !== currentWorkspace.id) {
      setError(
        new UserFacingError(
          pick(
            "该学习档案不属于当前学习主题。",
            "This profile does not belong to the current learning topic.",
          ),
        ),
      );
      return;
    }
    setError(null);
    flushSync(() => setLearner(learner));
    void navigate("/overview");
  };

  return (
    <main className="min-h-screen bg-[#F6F7F9] px-4 py-5 dark:bg-slate-950 sm:px-6 sm:py-8 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center gap-3 sm:mb-10">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3157D5] text-lg font-bold text-white">
            K
          </div>
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">
              KnowTier
            </p>
            <p className="text-xs text-slate-500">{t("shell.productTagline")}</p>
          </div>
          <label className="ml-auto inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            <Languages className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t("shell.interfaceLanguage")}</span>
            <select
              value={locale}
              onChange={(event) => setLocale(event.target.value === "en" ? "en" : "zh-CN")}
              className="rounded-md bg-transparent font-medium outline-none focus-visible:ring-2 focus-visible:ring-[#3157D5]/40"
              aria-label={t("shell.interfaceLanguage")}
            >
              <option value="zh-CN">中文</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
        <div className="grid gap-5 lg:grid-cols-[1fr_1.25fr] lg:gap-8">
          <section className="pt-3">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-[#3157D5]">
              {pick("开始使用", "Get started")}
            </p>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-3xl font-semibold tracking-tight text-slate-900 outline-none dark:text-white"
            >
              {pick("准备好你的专属学习助手", "Set up your personal learning assistant")}
            </h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">
              {pick("只需告诉我们你想学什么、希望怎样称呼你。没有资料也可以直接开始提问。", "Tell us what you want to learn and what we should call you. You can begin even without any materials.")}
            </p>
            <div className="mt-8 hidden space-y-4 sm:block">
              {[
                pick("没有资料也能直接提问", "Ask questions even without materials"),
                pick("每次讲解后用一个小问题确认理解", "Check understanding with one short question"),
                pick("有资料时自动附上来源，学习进度持续记录", "Link sources when materials are used and keep progress over time"),
              ].map((item, index) => (
                <div
                  key={item}
                  className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-50 text-[#3157D5] dark:bg-indigo-950">
                    <Check className="h-4 w-4" />
                  </span>
                  {item}
                  <span className="ml-auto font-mono text-[10px] text-slate-600 dark:text-slate-300">
                    0{index + 1}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8" aria-busy={busy}>
            {step === "workspace" && currentWorkspace && currentLearner && (
              <button
                type="button"
                onClick={() => void navigate("/overview")}
                className="mb-5 flex w-full items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-left text-sm text-indigo-900 transition-colors hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100 dark:hover:bg-indigo-950/70"
              >
                <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {pick("继续当前学习", "Continue current learning")}
                  </span>
                  <span className="block truncate text-xs opacity-75">
                    {currentWorkspace.name} · {currentLearner.display_name}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
            )}
            <ol className="mb-6 grid grid-cols-2 gap-2" aria-label={pick("设置进度", "Setup progress")}>
              {[
                { id: "workspace", number: "1", label: pick("学习主题", "Learning topic") },
                { id: "learner", number: "2", label: pick("你的称呼", "Your name") },
              ].map((item) => {
                const active = step === item.id;
                const complete = step === "learner" && item.id === "workspace";
                return (
                  <li
                    key={item.id}
                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ${active ? "bg-indigo-50 text-[#3157D5] dark:bg-indigo-950/50 dark:text-indigo-300" : complete ? "text-emerald-700 dark:text-emerald-300" : "text-slate-600 dark:text-slate-300"}`}
                    aria-current={active ? "step" : undefined}
                  >
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full ${active ? "bg-[#3157D5] text-white" : complete ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950" : "bg-slate-100 dark:bg-slate-800"}`}>
                      {complete ? <Check className="h-3.5 w-3.5" /> : item.number}
                    </span>
                    {item.label}
                  </li>
                );
              })}
            </ol>
            {step === "workspace" ? (
              <WorkspaceStep
                form={workspaceForm}
                busy={busy}
                onSubmit={handleWorkspace}
                existingId={existingWorkspaceId}
                setExistingId={setExistingWorkspaceId}
                available={availableWorkspaces}
                discoveryPending={workspacesQuery.isPending}
                discoveryError={workspacesQuery.isError}
                onRetryDiscovery={() => void workspacesQuery.refetch()}
                hasMore={workspacesQuery.hasNextPage}
                loadingMore={workspacesQuery.isFetchingNextPage}
                onLoadMore={() => void workspacesQuery.fetchNextPage()}
                onChoose={chooseExistingWorkspace}
                onUseAvailable={useKnownWorkspace}
              />
            ) : (
              <LearnerStep
                form={learnerForm}
                busy={busy}
                mode={learnerMode}
                setMode={setLearnerMode}
                existingId={existingLearnerId}
                setExistingId={setExistingLearnerId}
                available={availableLearners}
                discoveryPending={learnersQuery.isPending}
                discoveryError={learnersQuery.isError}
                onRetryDiscovery={() => void learnersQuery.refetch()}
                hasMore={learnersQuery.hasNextPage}
                loadingMore={learnersQuery.isFetchingNextPage}
                onLoadMore={() => void learnersQuery.fetchNextPage()}
                onSubmit={handleLearner}
                onVerify={verifyExistingLearner}
                onUseExisting={useKnownLearner}
                onBack={() => setStep("workspace")}
              />
            )}
            {error !== null && (
              <div className="mt-5">
                <ErrorState error={error} />
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function WorkspaceStep({
  form,
  busy,
  onSubmit,
  existingId,
  setExistingId,
  available,
  discoveryPending,
  discoveryError,
  onRetryDiscovery,
  hasMore,
  loadingMore,
  onLoadMore,
  onChoose,
  onUseAvailable,
}: {
  form: ReturnType<typeof useForm<WorkspaceValues>>;
  busy: boolean;
  onSubmit: (values: WorkspaceValues) => Promise<void>;
  existingId: string;
  setExistingId: (value: string) => void;
  available: Workspace[];
  discoveryPending: boolean;
  discoveryError: boolean;
  onRetryDiscovery: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onChoose: () => void;
  onUseAvailable: (workspace: Workspace) => void;
}) {
  const { pick } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const {
    register,
    handleSubmit,
    getFieldState,
    setValue,
    formState: { errors },
  } = form;
  const nameField = register("name", {
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      if (!getFieldState("slug").isDirty) {
        const slug = workspaceSlugFromName(event.target.value);
        setValue("slug", slug, {
          shouldDirty: false,
          shouldValidate: Boolean(slug),
        });
      }
    },
  });
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
          {pick("你想学习什么？", "What would you like to learn?")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {pick("可以是一门课程、一个考试目标，或任何你正在探索的主题。", "Use a course, exam goal, or any topic you are exploring.")}
        </p>
      </div>
      {available.length > 0 && (
        <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 dark:border-indigo-900 dark:bg-indigo-950/25">
          <p className="mb-2 text-xs font-semibold text-indigo-900 dark:text-indigo-200">
            {pick("选择已有主题继续", "Continue an existing topic")}
          </p>
          <div className="space-y-1">
            {(showAll ? available : available.slice(0, 8)).map((workspace) => (
              <button
                type="button"
                key={workspace.id}
                disabled={busy}
                onClick={() => onUseAvailable(workspace)}
                className="flex w-full items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-left text-sm hover:bg-white dark:bg-slate-900/70 dark:hover:bg-slate-900"
              >
                <span className="truncate">{workspace.name}</span>
                <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
              </button>
            ))}
          </div>
          {available.length > 8 && (
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="mt-2 w-full rounded-lg px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-white/70 dark:text-indigo-300 dark:hover:bg-slate-900/60"
            >
              {showAll
                ? pick("收起", "Show less")
                : pick(`显示全部 ${available.length} 个主题`, `Show all ${available.length} topics`)}
            </button>
          )}
          {hasMore && (
            <button
              type="button"
              disabled={loadingMore}
              onClick={onLoadMore}
              className="secondary-button mt-2 w-full text-xs"
            >
              {loadingMore ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              {pick("加载更早的主题", "Load older topics")}
            </button>
          )}
        </div>
      )}
      {discoveryPending && available.length === 0 && (
        <p className="mb-5 flex items-center gap-2 text-xs text-slate-500" role="status">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {pick("正在查找本机已有主题…", "Looking for saved topics on this device…")}
        </p>
      )}
      {discoveryError && (
        <div
          className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          role="alert"
        >
          <span>
            {pick(
              available.length > 0
                ? "暂时无法检查全部已保存主题，当前仅显示本机最近记录。"
                : "暂时无法查找已保存主题。请重试，或在下方创建新主题。",
              available.length > 0
                ? "Saved topics could not all be checked. Only recent topics from this device are shown."
                : "Saved topics could not be loaded. Retry, or create a new topic below.",
            )}
          </span>
          <button
            type="button"
            className="secondary-button min-h-8 px-2 py-1 text-xs"
            onClick={onRetryDiscovery}
          >
            {pick("重试查找", "Retry lookup")}
          </button>
        </div>
      )}
      {available.length > 0 && (
        <div className="mb-5 flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          {pick("或创建新主题", "Or create a new topic")}
          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        </div>
      )}
      <form
        className="space-y-4"
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      >
        <Field
          inputId="workspace-name"
          label={pick("学习主题", "Learning topic")}
          error={errors.name?.message}
          errorId="workspace-name-error"
        >
          <input
            {...nameField}
            id="workspace-name"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "workspace-name-error" : undefined}
            placeholder={pick("例如：零基础学习机器学习", "For example: Machine learning from scratch")}
            className="form-input"
            autoFocus={available.length === 0}
          />
        </Field>
        <Field
          inputId="workspace-default-language"
          label={pick("默认学习语言", "Default learning language")}
        >
          <select
            {...register("default_language")}
            id="workspace-default-language"
            className="form-input"
          >
            <option value="zh-CN">中文</option>
            <option value="en">English</option>
          </select>
        </Field>
        <details className="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
          <summary className="cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-300">
            {pick("高级设置（通常无需修改）", "Advanced settings (usually unchanged)")}
          </summary>
          <div className="mt-3 space-y-4">
            <Field
              inputId="workspace-slug"
              label={pick("空间标识（已自动生成，可修改）", "Workspace identifier (generated automatically)")}
              error={errors.slug?.message}
              errorId="workspace-slug-error"
            >
              <input
                {...register("slug")}
                id="workspace-slug"
                aria-invalid={Boolean(errors.slug)}
                aria-describedby={errors.slug ? "workspace-slug-error" : undefined}
                placeholder="machine-learning"
                className="form-input font-mono text-xs"
              />
            </Field>
            <Field
              inputId="workspace-provisioning-token"
              label={pick("部署凭据（如管理员提供）", "Provisioning credential (if provided by an administrator)")}
            >
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  {...register("provisioningToken")}
                  id="workspace-provisioning-token"
                  type="password"
                  autoComplete="off"
                  placeholder={pick("仅用于本次创建", "Used only for this request")}
                  className="form-input pl-9"
                />
              </div>
            </Field>
          </div>
        </details>
        <button type="submit" disabled={busy} className="primary-button w-full">
          {busy ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {pick("保存主题，下一步", "Save topic and continue")}
          <ChevronRight className="ml-auto h-4 w-4" />
        </button>
      </form>
      <details className="mt-6 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
        <summary className="cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-300">
          {pick("已有学习空间或管理员给了我一个标识", "I already have a workspace or an ID from an administrator")}
        </summary>
        <div className="mt-3">
          <p className="mb-2 text-xs leading-5 text-slate-500">
            {pick("仅在你知道学习空间标识时使用；第一次使用请直接完成上方步骤。", "Use this only if you know the workspace ID. First-time users can complete the steps above.")}
          </p>
          <div className="flex gap-2">
            <input
              value={existingId}
              onChange={(event) => setExistingId(event.target.value)}
              placeholder={pick("学习空间标识", "Workspace ID")}
              aria-label={pick("已有学习空间标识", "Existing workspace ID")}
              className="form-input font-mono text-xs"
            />
            <button
              type="button"
              onClick={onChoose}
              disabled={busy}
              className="secondary-button shrink-0"
            >
              {pick("连接", "Connect")}
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}

function LearnerStep({
  form,
  busy,
  mode,
  setMode,
  existingId,
  setExistingId,
  available,
  discoveryPending,
  discoveryError,
  onRetryDiscovery,
  hasMore,
  loadingMore,
  onLoadMore,
  onSubmit,
  onVerify,
  onUseExisting,
  onBack,
}: {
  form: ReturnType<typeof useForm<LearnerValues>>;
  busy: boolean;
  mode: "create" | "existing";
  setMode: (mode: "create" | "existing") => void;
  existingId: string;
  setExistingId: (value: string) => void;
  available: Learner[];
  discoveryPending: boolean;
  discoveryError: boolean;
  onRetryDiscovery: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onSubmit: (values: LearnerValues) => Promise<void>;
  onVerify: (id?: string) => Promise<void>;
  onUseExisting: (learner: Learner) => void;
  onBack: () => void;
}) {
  const { pick } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;
  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
            {pick("我们怎么称呼你？", "What should we call you?")}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {pick("这个称呼只用于欢迎语和区分本设备上的学习档案，不必填写真实姓名。", "This name is used for greetings and local profiles. It does not need to be your real name.")}
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md text-xs text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3157D5]/40 dark:text-slate-300 dark:hover:text-white"
        >
          {pick("返回修改主题", "Back to topic")}
        </button>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
        <button
          type="button"
          onClick={() => setMode("create")}
          aria-pressed={mode === "create"}
          className={`rounded-md py-2 text-xs font-medium ${mode === "create" ? "bg-white text-[#3157D5] shadow-sm dark:bg-slate-700" : "text-slate-500"}`}
        >
          <Plus className="mr-1 inline h-3.5 w-3.5" />
          {pick("第一次使用", "First time here")}
        </button>
        <button
          type="button"
          onClick={() => setMode("existing")}
          aria-pressed={mode === "existing"}
          className={`rounded-md py-2 text-xs font-medium ${mode === "existing" ? "bg-white text-[#3157D5] shadow-sm dark:bg-slate-700" : "text-slate-500"}`}
        >
          <UserRound className="mr-1 inline h-3.5 w-3.5" />
          {pick("使用已有档案", "Use an existing profile")}
        </button>
      </div>
      {mode === "create" ? (
        <form
          className="space-y-4"
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        >
          <Field
            inputId="learner-display-name"
            label={pick("希望怎样称呼你", "What should we call you?")}
            error={errors.display_name?.message}
            errorId="learner-name-error"
          >
            <input
              {...register("display_name")}
              id="learner-display-name"
              aria-invalid={Boolean(errors.display_name)}
              aria-describedby={
                errors.display_name ? "learner-name-error" : undefined
              }
              placeholder={pick("例如：小林", "For example: Alex")}
              className="form-input"
              autoFocus
            />
          </Field>
          <Field
            inputId="learner-language"
            label={pick("学习语言", "Learning language")}
          >
            <select
              {...register("language")}
              id="learner-language"
              className="form-input"
            >
              <option value="zh-CN">中文</option>
              <option value="en">English</option>
            </select>
          </Field>
          <button
            type="submit"
            disabled={busy}
            className="primary-button w-full"
          >
            {busy ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <UserRound className="h-4 w-4" />
            )}
            {pick("完成设置，开始使用", "Finish setup and get started")}
            <ChevronRight className="ml-auto h-4 w-4" />
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          {available.length > 0 ? (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 dark:border-indigo-900 dark:bg-indigo-950/25">
              <p className="mb-2 text-xs font-semibold text-indigo-900 dark:text-indigo-200">
                {pick("选择已有学习档案", "Choose an existing profile")}
              </p>
              <div className="space-y-1">
                {(showAll ? available : available.slice(0, 8)).map((learner) => (
                  <button
                    type="button"
                    key={learner.id}
                    disabled={busy}
                    onClick={() => onUseExisting(learner)}
                    className="flex w-full items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-left text-sm hover:bg-white dark:bg-slate-900/70 dark:hover:bg-slate-900"
                  >
                    <span className="truncate">{learner.display_name}</span>
                    <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  </button>
                ))}
              </div>
              {available.length > 8 && (
                <button
                  type="button"
                  onClick={() => setShowAll((value) => !value)}
                  className="mt-2 w-full rounded-lg px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-white/70 dark:text-indigo-300 dark:hover:bg-slate-900/60"
                >
                  {showAll
                    ? pick("收起", "Show less")
                    : pick(`显示全部 ${available.length} 个档案`, `Show all ${available.length} profiles`)}
                </button>
              )}
              {hasMore && (
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={onLoadMore}
                  className="secondary-button mt-2 w-full text-xs"
                >
                  {loadingMore ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {pick("加载更早的档案", "Load older profiles")}
                </button>
              )}
            </div>
          ) : discoveryPending ? (
            <p className="flex items-center gap-2 text-xs text-slate-500" role="status">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              {pick("正在查找已有学习档案…", "Looking for saved profiles…")}
            </p>
          ) : discoveryError ? (
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
              role="alert"
            >
              <span>
                {pick(
                  "暂时无法查找已有学习档案，请重试；我们不会把加载失败当作“没有档案”。",
                  "Saved profiles could not be loaded. Retry; a loading failure is not treated as an empty list.",
                )}
              </span>
              <button
                type="button"
                className="secondary-button min-h-8 px-2 py-1 text-xs"
                onClick={onRetryDiscovery}
              >
                {pick("重试查找", "Retry lookup")}
              </button>
            </div>
          ) : (
            <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-500 dark:bg-slate-800/60">
              {pick(
                "这个主题下还没有找到学习档案。你可以选择“第一次使用”创建一个。",
                "No saved profile was found for this topic. Choose “First time here” to create one.",
              )}
            </p>
          )}
          <details className="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
            <summary className="cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-300">
              {pick("高级：使用学习者标识", "Advanced: use a learner ID")}
            </summary>
            <div className="mt-3 space-y-3">
              <Field
                inputId="existing-learner-id"
                label={pick("学习者标识", "Learner ID")}
              >
                <input
                  id="existing-learner-id"
                  value={existingId}
                  onChange={(event) => setExistingId(event.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="form-input font-mono text-xs"
                />
              </Field>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onVerify()}
                  className="secondary-button w-full"
                >
                  {busy ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  {pick("验证并继续", "Verify and continue")}
                </button>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

function Field({
  inputId,
  label,
  error,
  errorId,
  children,
}: {
  inputId: string;
  label: string;
  error?: string;
  errorId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block space-y-1.5">
      <label
        htmlFor={inputId}
        className="block text-xs font-medium text-slate-600 dark:text-slate-300"
      >
        {label}
      </label>
      {children}
      {error && (
        <span id={errorId} className="block text-xs text-red-600" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
