import { zodResolver } from "@hookform/resolvers/zod";
import {
  Check,
  ChevronRight,
  KeyRound,
  LoaderCircle,
  Plus,
  UserRound,
} from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { api } from "@/services/api";
import { ApiError } from "@/lib/api/errors";
import { isUuid } from "@/lib/utils";
import { useAppStore } from "@/stores/AppContext";
import { ErrorState } from "@/components/shared/States";

const workspaceSchema = z.object({
  name: z.string().trim().min(1, "请输入学习空间名称").max(200),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "Slug 只能使用小写字母、数字和连字符"),
  default_language: z.string().min(2),
  provisioningToken: z.string().optional(),
});
const learnerSchema = z.object({
  display_name: z.string().trim().min(1, "请输入学习者名称").max(200),
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

export function InitPage() {
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
      workspaceForm.setValue("provisioningToken", "");
      setStep("learner");
    } catch (requestError) {
      setError(requestError);
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
      setStep("learner");
    } catch (requestError) {
      setError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const chooseExistingWorkspace = () => {
    const id = existingWorkspaceId.trim();
    if (!isUuid(id)) {
      setError(new Error("请输入有效的学习空间 ID。"));
      return;
    }
    void connectExistingWorkspace(id);
  };

  const handleLearner = async (values: LearnerValues) => {
    if (!currentWorkspace) {
      setError(new Error("请先选择学习空间。"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const learner = await api.createLearner({
        workspace_id: currentWorkspace.id,
        ...values,
      });
      setLearner(learner);
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
      setError(new Error("请输入有效的学习者 UUID。"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const learner = await api.getLearner(learnerId);
      if (learner.workspace_id !== currentWorkspace.id)
        throw new ApiError({
          message: "该学习者不属于当前学习空间。",
          status: 403,
          kind: "forbidden",
        });
      setLearner(learner);
      void navigate("/overview");
    } catch (requestError) {
      setError(requestError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F7F9] px-4 py-5 dark:bg-slate-950 sm:px-6 sm:py-8 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center gap-3 sm:mb-10">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3157D5] text-lg font-bold text-white">
            K
          </div>
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">
              KnowTier
            </p>
            <p className="text-xs text-slate-500">认知学习工作台</p>
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-[1fr_1.25fr] lg:gap-8">
          <section className="pt-3">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-[#3157D5]">
              开始使用
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
              建立你的学习空间
            </h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">
              创建学习空间和个人档案后，即可上传资料、开始学习并持续追踪掌握变化。
            </p>
            <div className="mt-8 hidden space-y-4 sm:block">
              {[
                "资料、对话与知识域彼此隔离",
                "六级认知层级追踪",
                "可追溯的学习者图谱",
              ].map((item, index) => (
                <div
                  key={item}
                  className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-50 text-[#3157D5] dark:bg-indigo-950">
                    <Check className="h-4 w-4" />
                  </span>
                  {item}
                  <span className="ml-auto font-mono text-[10px] text-slate-400">
                    0{index + 1}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8" aria-busy={busy}>
            <ol className="mb-6 grid grid-cols-2 gap-2" aria-label="设置进度">
              {[
                { id: "workspace", number: "1", label: "学习空间" },
                { id: "learner", number: "2", label: "学习者" },
              ].map((item) => {
                const active = step === item.id;
                const complete = step === "learner" && item.id === "workspace";
                return (
                  <li
                    key={item.id}
                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ${active ? "bg-indigo-50 text-[#3157D5] dark:bg-indigo-950/50 dark:text-indigo-300" : complete ? "text-emerald-700 dark:text-emerald-300" : "text-slate-400"}`}
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
                recent={recentWorkspaces}
                onChoose={chooseExistingWorkspace}
                onUseRecent={(workspace) =>
                  void connectExistingWorkspace(workspace.id)
                }
              />
            ) : (
              <LearnerStep
                form={learnerForm}
                busy={busy}
                mode={learnerMode}
                setMode={setLearnerMode}
                existingId={existingLearnerId}
                setExistingId={setExistingLearnerId}
                recent={recentLearners.filter(
                  (learner) => learner.workspace_id === currentWorkspace?.id,
                )}
                onSubmit={handleLearner}
                onVerify={verifyExistingLearner}
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
    </div>
  );
}

function WorkspaceStep({
  form,
  busy,
  onSubmit,
  existingId,
  setExistingId,
  recent,
  onChoose,
  onUseRecent,
}: {
  form: ReturnType<typeof useForm<WorkspaceValues>>;
  busy: boolean;
  onSubmit: (values: WorkspaceValues) => Promise<void>;
  existingId: string;
  setExistingId: (value: string) => void;
  recent: ReturnType<typeof useAppStore>["recentWorkspaces"];
  onChoose: () => void;
  onUseRecent: (
    workspace: ReturnType<typeof useAppStore>["recentWorkspaces"][number],
  ) => void;
}) {
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
          学习空间
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          创建一个空间来归档你的资料、对话与学习记录。
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      >
        <Field label="名称" error={errors.name?.message}>
          <input
            {...nameField}
            placeholder="例如：机器学习基础"
            className="form-input"
            autoFocus
          />
        </Field>
        <Field label="默认语言">
          <select {...register("default_language")} className="form-input">
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </Field>
        <details className="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
          <summary className="cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-300">
            高级设置（通常无需修改）
          </summary>
          <div className="mt-3 space-y-4">
            <Field
              label="空间标识（已自动生成，可修改）"
              error={errors.slug?.message}
            >
              <input
                {...register("slug")}
                placeholder="machine-learning"
                className="form-input font-mono text-xs"
              />
            </Field>
            <Field label="部署凭据（如管理员提供）">
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  {...register("provisioningToken")}
                  type="password"
                  autoComplete="off"
                  placeholder="仅用于本次创建"
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
          创建学习空间
          <ChevronRight className="ml-auto h-4 w-4" />
        </button>
      </form>
      <div className="my-6 flex items-center gap-3 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        或使用已有学习空间
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
      </div>
      <div className="flex gap-2">
        <input
          value={existingId}
          onChange={(event) => setExistingId(event.target.value)}
          placeholder="学习空间 ID"
          className="form-input font-mono text-xs"
        />
        <button
          type="button"
          onClick={onChoose}
          disabled={busy}
          className="secondary-button shrink-0"
        >
          连接
        </button>
      </div>
      {recent.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-xs font-medium text-slate-500">
            本设备最近使用
          </p>
          <div className="space-y-1">
            {recent.slice(0, 4).map((workspace) => (
              <button
                type="button"
                key={workspace.id}
                disabled={busy}
                onClick={() => onUseRecent(workspace)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
              >
                <span className="truncate">{workspace.name}</span>
                <span className="font-mono text-[10px] text-slate-400">
                  {workspace.id.slice(0, 8)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
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
  recent,
  onSubmit,
  onVerify,
  onBack,
}: {
  form: ReturnType<typeof useForm<LearnerValues>>;
  busy: boolean;
  mode: "create" | "existing";
  setMode: (mode: "create" | "existing") => void;
  existingId: string;
  setExistingId: (value: string) => void;
  recent: ReturnType<typeof useAppStore>["recentLearners"];
  onSubmit: (values: LearnerValues) => Promise<void>;
  onVerify: (id?: string) => Promise<void>;
  onBack: () => void;
}) {
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
            学习者
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            创建个人学习档案，或验证已有学习者 ID。
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-slate-400 hover:text-slate-700"
        >
          返回学习空间
        </button>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
        <button
          type="button"
          onClick={() => setMode("create")}
          className={`rounded-md py-2 text-xs font-medium ${mode === "create" ? "bg-white text-[#3157D5] shadow-sm dark:bg-slate-700" : "text-slate-500"}`}
        >
          <Plus className="mr-1 inline h-3.5 w-3.5" />
          创建学习者
        </button>
        <button
          type="button"
          onClick={() => setMode("existing")}
          className={`rounded-md py-2 text-xs font-medium ${mode === "existing" ? "bg-white text-[#3157D5] shadow-sm dark:bg-slate-700" : "text-slate-500"}`}
        >
          <UserRound className="mr-1 inline h-3.5 w-3.5" />
          验证已有 ID
        </button>
      </div>
      {mode === "create" ? (
        <form
          className="space-y-4"
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        >
          <Field label="显示名称" error={errors.display_name?.message}>
            <input
              {...register("display_name")}
              placeholder="例如：林同学"
              className="form-input"
              autoFocus
            />
          </Field>
          <Field label="学习语言">
            <select {...register("language")} className="form-input">
              <option value="zh-CN">简体中文</option>
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
            创建并进入总览
            <ChevronRight className="ml-auto h-4 w-4" />
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <Field label="Learner UUID">
            <input
              value={existingId}
              onChange={(event) => setExistingId(event.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="form-input font-mono text-xs"
              autoFocus
            />
          </Field>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onVerify()}
            className="primary-button w-full"
          >
            {busy ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            验证并进入总览
          </button>
          {recent.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-slate-500">
                本设备最近学习者
              </p>
              {recent.slice(0, 5).map((learner) => (
                <button
                  type="button"
                  key={learner.id}
                  onClick={() => {
                    setExistingId(learner.id);
                    void onVerify(learner.id);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
                >
                  <span>{learner.display_name}</span>
                  <span className="font-mono text-[10px] text-slate-400">
                    {learner.id.slice(0, 8)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
        {label}
      </span>
      {children}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
}
