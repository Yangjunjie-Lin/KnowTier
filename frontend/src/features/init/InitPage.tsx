import { zodResolver } from "@hookform/resolvers/zod";
import {
  Check,
  ChevronRight,
  KeyRound,
  LoaderCircle,
  Plus,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { api } from "@/services/api";
import { ApiError } from "@/lib/api/errors";
import { isUuid } from "@/lib/utils";
import { useAppStore } from "@/stores/AppContext";
import { ErrorState } from "@/components/shared/States";

const workspaceSchema = z.object({
  name: z.string().trim().min(1, "请输入 Workspace 名称").max(200),
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

  const chooseExistingWorkspace = () => {
    const id = existingWorkspaceId.trim();
    if (!isUuid(id)) {
      setError(new Error("请输入有效的 Workspace UUID。"));
      return;
    }
    setWorkspace({
      id,
      name: "已连接 Workspace",
      slug: id.slice(0, 8),
      default_language: "zh-CN",
      created_at: new Date().toISOString(),
    });
    setStep("learner");
    setError(null);
  };

  const handleLearner = async (values: LearnerValues) => {
    if (!currentWorkspace) {
      setError(new Error("请先选择 Workspace。"));
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
          message: "该学习者不属于当前 Workspace。",
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
    <div className="min-h-screen bg-[#F6F7F9] px-4 py-8 dark:bg-slate-950 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 flex items-center gap-3">
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
        <div className="grid gap-8 lg:grid-cols-[1fr_1.25fr]">
          <section className="pt-3">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-[#3157D5]">
              开始使用
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
              建立你的学习空间
            </h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">
              连接一个 Workspace 和学习者，KnowTier
              会将每次对话、证据与图谱版本保存到真实后端。
            </p>
            <div className="mt-8 space-y-4">
              {[
                "Workspace 隔离与知识域",
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
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
            <div className="mb-7 flex items-center gap-2">
              <div
                className={`h-1.5 flex-1 rounded-full ${step === "workspace" ? "bg-[#3157D5]" : "bg-emerald-500"}`}
              />
              <div
                className={`h-1.5 flex-1 rounded-full ${step === "learner" ? "bg-[#3157D5]" : "bg-slate-100 dark:bg-slate-800"}`}
              />
            </div>
            {step === "workspace" ? (
              <WorkspaceStep
                form={workspaceForm}
                busy={busy}
                onSubmit={handleWorkspace}
                existingId={existingWorkspaceId}
                setExistingId={setExistingWorkspaceId}
                recent={recentWorkspaces}
                onChoose={chooseExistingWorkspace}
                onUseRecent={(workspace) => {
                  setWorkspace(workspace);
                  setStep("learner");
                }}
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
                <ErrorState error={error} onRetry={() => setError(null)} />
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
    formState: { errors },
  } = form;
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
          Workspace
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          创建新的知识域，或连接本设备记录的 Workspace。
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      >
        <Field label="名称" error={errors.name?.message}>
          <input
            {...register("name")}
            placeholder="例如：机器学习基础"
            className="form-input"
            autoFocus
          />
        </Field>
        <Field label="Slug" error={errors.slug?.message}>
          <input
            {...register("slug")}
            placeholder="machine-learning"
            className="form-input"
          />
        </Field>
        <Field label="默认语言">
          <select {...register("default_language")} className="form-input">
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </Field>
        <Field label="Provisioning Token（生产环境按需）">
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              {...register("provisioningToken")}
              type="password"
              autoComplete="off"
              placeholder="仅本次请求使用"
              className="form-input pl-9"
            />
          </div>
        </Field>
        <button type="submit" disabled={busy} className="primary-button w-full">
          {busy ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          创建 Workspace
          <ChevronRight className="ml-auto h-4 w-4" />
        </button>
      </form>
      <div className="my-6 flex items-center gap-3 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        或连接已有 ID
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
      </div>
      <div className="flex gap-2">
        <input
          value={existingId}
          onChange={(event) => setExistingId(event.target.value)}
          placeholder="Workspace UUID"
          className="form-input font-mono text-xs"
        />
        <button
          type="button"
          onClick={onChoose}
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
          返回 Workspace
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
