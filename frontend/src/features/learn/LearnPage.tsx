import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  BookOpen,
  Camera,
  CheckCircle2,
  ChevronDown,
  FileText,
  Layers3,
  Lightbulb,
  LoaderCircle,
  Paperclip,
  RotateCcw,
  Send,
  Sparkles,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  CognitiveBadge,
  CognitiveLevelTrack,
  MasteryBar,
} from "@/components/shared/LearningVisuals";
import { EmptyState, ErrorState } from "@/components/shared/States";
import { PageHeader } from "@/components/shared/PageHeader";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { api } from "@/services/api";
import {
  documentsForWorkspace,
  useAppStore,
} from "@/stores/AppContext";
import type {
  ChatResponse,
  JsonObject,
  RequestedMode,
  UUID,
} from "@/types/api";
import {
  mergeQuickPrompt,
  quickTeachingActions,
} from "./quickTeachingActions";
import {
  assessmentTypeLabel,
  learnerDecisionLabel,
  teachingActionLabel,
  teachingModeLabel,
  teachingModes,
  toolNameLabel,
} from "./teachingLabels";

interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachmentNames?: string[];
  result?: ChatResponse;
}

export interface LearningTarget {
  id?: UUID;
  name: string;
  prompt?: string;
  source?: string;
}

type UploadStage = "upload" | "ingest" | "attachment";

interface UploadOperation {
  fileName: string;
  stage: UploadStage;
  pending: boolean;
  error: unknown;
}

interface ChatSubmission {
  text: string;
  attachmentIds: UUID[];
  requestedMode: RequestedMode;
}

const acceptedMaterialTypes =
  ".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg,.tif,.tiff";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function learningTargetFromState(state: unknown): LearningTarget | null {
  if (!isRecord(state) || !isRecord(state.learningTarget)) return null;
  const target = state.learningTarget;
  if (typeof target.name !== "string" || !target.name.trim()) return null;
  return {
    name: target.name.trim(),
    ...(typeof target.id === "string" ? { id: target.id } : {}),
    ...(typeof target.prompt === "string" && target.prompt.trim()
      ? { prompt: target.prompt.trim() }
      : {}),
    ...(typeof target.source === "string" && target.source.trim()
      ? { source: target.source.trim() }
      : {}),
  };
}

export function learningTargetDraft(target: LearningTarget | null): string {
  if (!target) return "";
  return (
    target.prompt ??
    `我想学习“${target.name}”。请先和我确认学习目标，再开始讲解。`
  );
}

export function LearnPage() {
  const {
    currentWorkspace,
    currentLearner,
    sessionId,
    recentDocuments,
    preferences,
    rememberDocument,
    newSession,
  } = useAppStore();
  const location = useLocation();
  const queryClient = useQueryClient();
  const navigationTarget = useMemo(
    () => learningTargetFromState(location.state),
    [location.state],
  );
  const [navigationTargetConfirmed, setNavigationTargetConfirmed] =
    useState(false);
  const [mode, setMode] = useState<RequestedMode>(
    preferences.defaultTeachingMode,
  );
  const [message, setMessage] = useState(() =>
    learningTargetDraft(navigationTarget),
  );
  const [attachments, setAttachments] = useState<UUID[]>([]);
  const attachmentIdsRef = useRef<UUID[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [showAttachments, setShowAttachments] = useState(false);
  const [uploadOperation, setUploadOperation] =
    useState<UploadOperation | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const availableDocuments = useMemo(
    () => documentsForWorkspace(recentDocuments, currentWorkspace?.id),
    [currentWorkspace?.id, recentDocuments],
  );
  const latestResult = useMemo(
    () =>
      [...messages]
        .reverse()
        .find((item) => item.result !== undefined)?.result,
    [messages],
  );

  const replaceAttachments = (next: UUID[]) => {
    attachmentIdsRef.current = next;
    setAttachments(next);
  };

  const chatMutation = useMutation({
    mutationFn: (input: ChatSubmission) =>
      api.chat({
        workspace_id: currentWorkspace!.id,
        learner_id: currentLearner!.id,
        session_id: sessionId,
        message: input.text,
        attachment_ids: input.attachmentIds,
        requested_mode: input.requestedMode,
      }),
    onSuccess: (result) => {
      setMessages((current) => [
        ...current,
        {
          id: result.turn_id,
          role: "assistant",
          text: result.response,
          result,
        },
      ]);
      setMessage("");
      replaceAttachments([]);
      setNavigationTargetConfirmed(true);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.model(currentLearner!.id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.evidence(currentLearner!.id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.learnerGraph(currentLearner!.id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.learnerRevisions(currentLearner!.id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.manifest(currentWorkspace!.id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.domainGraph(currentWorkspace!.id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.domainRevisions(currentWorkspace!.id),
      });
      void queryClient.invalidateQueries({
        queryKey: ["learning-path", currentLearner!.id],
      });
    },
  });

  if (!currentWorkspace || !currentLearner) {
    return (
      <EmptyState
        title="请先完成初始化"
        description="学习空间需要当前 Workspace 和学习者。"
      />
    );
  }

  const toggleAttachment = (id: UUID) => {
    const current = attachmentIdsRef.current;
    if (current.includes(id)) {
      replaceAttachments(current.filter((value) => value !== id));
      return;
    }
    if (current.length >= 20) {
      setUploadOperation({
        fileName: "附件",
        stage: "attachment",
        pending: false,
        error: new Error("每轮最多加入 20 份附件。"),
      });
      return;
    }
    replaceAttachments([...current, id]);
  };

  const processUpload = async (file: File) => {
    if (chatMutation.isPending || uploadOperation?.pending) return;
    setUploadOperation({
      fileName: file.name,
      stage: "upload",
      pending: true,
      error: null,
    });
    let uploaded;
    try {
      uploaded = await api.uploadDocument(currentWorkspace.id, file);
      rememberDocument(uploaded);
    } catch (error) {
      setUploadOperation({
        fileName: file.name,
        stage: "upload",
        pending: false,
        error,
      });
      return;
    }

    if (uploaded.status !== "INGESTED") {
      setUploadOperation({
        fileName: file.name,
        stage: "ingest",
        pending: true,
        error: null,
      });
      try {
        await api.ingestDocument(uploaded.id);
        rememberDocument({ ...uploaded, status: "INGESTED" });
      } catch (error) {
        setUploadOperation({
          fileName: file.name,
          stage: "ingest",
          pending: false,
          error,
        });
        return;
      }
    }

    const current = attachmentIdsRef.current;
    if (!current.includes(uploaded.id) && current.length >= 20) {
      setUploadOperation({
        fileName: file.name,
        stage: "attachment",
        pending: false,
        error: new Error("资料已摄取，但本轮附件已达到 20 份上限。"),
      });
      return;
    }
    if (!current.includes(uploaded.id)) {
      replaceAttachments([...current, uploaded.id]);
    }
    setUploadOperation({
      fileName: file.name,
      stage: "attachment",
      pending: false,
      error: null,
    });
  };

  const submit = () => {
    const text = message.trim();
    if (!text || chatMutation.isPending) return;
    const attachmentIds = [...attachmentIdsRef.current];
    const attachmentNames = attachmentIds.map(
      (id) =>
        availableDocuments.find((document) => document.id === id)?.filename ??
        id.slice(0, 8),
    );
    setMessages((current) => [
      ...current,
      {
        id: `local-${crypto.randomUUID()}`,
        role: "user",
        text,
        attachmentNames,
      },
    ]);
    setShowAttachments(false);
    chatMutation.mutate({ text, attachmentIds, requestedMode: mode });
  };

  const currentKnowledgePoint =
    latestResult?.target_knowledge_point.name ?? navigationTarget?.name;
  const currentLevel = latestResult?.cognitive_level ?? 1;

  return (
    <div className="min-h-[calc(100vh-8rem)]">
      <PageHeader
        eyebrow="Teaching workspace"
        title="学习空间"
        description="讲解、掌握检测与模型变化分层呈现，每一轮都保持可追溯。"
        actions={
          <button
            type="button"
            onClick={() => {
              newSession();
              setMessages([]);
              setNavigationTargetConfirmed(false);
            }}
            disabled={chatMutation.isPending}
            className="secondary-button"
          >
            <RotateCcw className="h-4 w-4" />
            新建 Session
          </button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[250px_minmax(0,1fr)_300px]">
        <aside className="space-y-4" aria-label="教学上下文">
          <ContextPanel title="当前知识点">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {currentKnowledgePoint ?? "等待本轮教学响应确认"}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {latestResult
                ? `服务器目标 · ${latestResult.target_knowledge_point.id.slice(0, 8)}`
                : "尚未由服务器选定知识点"}
            </p>
          </ContextPanel>

          <ContextPanel title="学习目标">
            {navigationTarget ? (
              <div className="space-y-2">
                <span
                  className={cn(
                    "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                    navigationTargetConfirmed
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
                  )}
                >
                  {navigationTargetConfirmed ? "已发送确认请求" : "等待你确认"}
                </span>
                <p className="text-sm font-medium">{navigationTarget.name}</p>
                {navigationTarget.source && (
                  <p className="text-[11px] text-slate-400">
                    来自：{navigationTarget.source}
                  </p>
                )}
                <p className="text-xs leading-5 text-slate-500">
                  导航目标只预填消息；发送后以服务器返回的知识点为准。
                </p>
              </div>
            ) : (
              <p className="text-xs leading-5 text-slate-500">
                在消息中说明想学的内容，服务器会根据真实图谱选择目标。
              </p>
            )}
          </ContextPanel>

          <ContextPanel title="教学模式">
            <label className="sr-only" htmlFor="teaching-mode">
              教学模式
            </label>
            <select
              id="teaching-mode"
              value={mode}
              onChange={(event) =>
                setMode(event.target.value as RequestedMode)
              }
              className="form-input"
            >
              {teachingModes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} · {item.description}
                </option>
              ))}
            </select>
            <p className="mt-2 text-[11px] leading-5 text-slate-400">
              默认使用本设备设置中的“{teachingModeLabel(preferences.defaultTeachingMode)}”模式。
            </p>
          </ContextPanel>

          <ContextPanel title="六级认知轨道">
            <CognitiveLevelTrack currentLevel={currentLevel} compact />
            <p className="mt-2 text-xs text-slate-500">
              当前显示 L{currentLevel}，仅在服务器响应后更新。
            </p>
          </ContextPanel>

          <ContextPanel title="前置知识">
            <p className="text-xs leading-5 text-slate-500">
              {latestResult?.teaching_action === "REVIEW_PREREQUISITE"
                ? "本轮建议先复习前置知识；响应没有提供具体前置清单。"
                : "当前聊天响应没有提供前置知识清单。可使用下方快捷操作检查。"}
            </p>
          </ContextPanel>

          <ContextPanel title="Session">
            <p className="break-all font-mono text-[11px] text-slate-500">
              {sessionId}
            </p>
          </ContextPanel>
        </aside>

        <section className="flex min-h-[680px] min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-[#3157D5] dark:bg-indigo-950">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-medium">结构化教学内容</p>
                <p className="text-[11px] text-slate-400">
                  教师讲解与掌握检测分开呈现
                </p>
              </div>
            </div>
            <span className="text-[11px] text-slate-400">
              {teachingModeLabel(mode)}模式
            </span>
          </div>

          <div
            className="flex-1 space-y-5 overflow-y-auto p-5"
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <div className="flex min-h-80 flex-col items-center justify-center text-center">
                <BookOpen className="h-8 w-8 text-[#7B96EF]" />
                <h2 className="mt-3 text-base font-medium">
                  从一个知识点或问题开始
                </h2>
                <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">
                  你可以先上传资料或拍照，完成摄取后资料会自动加入本轮附件。教学响应将拆分为讲解、掌握检测和模型更新。
                </p>
              </div>
            ) : (
              messages.map((item) =>
                item.role === "user" ? (
                  <UserTurn key={item.id} message={item} />
                ) : item.result ? (
                  <TeachingTurn key={item.id} result={item.result} />
                ) : null,
              )
            )}
            {chatMutation.isPending && (
              <div
                className="flex items-center gap-2 text-sm text-slate-400"
                role="status"
              >
                <LoaderCircle className="h-4 w-4 animate-spin" />
                正在生成讲解、检查掌握并更新模型…
              </div>
            )}
            {chatMutation.isError && (
              <ErrorState
                error={chatMutation.error}
                onRetry={() => {
                  if (chatMutation.variables) {
                    chatMutation.mutate(chatMutation.variables);
                  }
                }}
              />
            )}
          </div>

          <div className="border-t border-slate-100 p-4 dark:border-slate-800">
            <div className="mb-3 flex flex-wrap gap-2" aria-label="快捷教学操作">
              {quickTeachingActions.map((action) => (
                <button
                  type="button"
                  key={action.id}
                  onClick={() => {
                    setMessage((current) =>
                      mergeQuickPrompt(current, action.prompt(preferences)),
                    );
                    inputRef.current?.focus();
                  }}
                  disabled={chatMutation.isPending}
                  className="quiet-button min-h-8 border border-slate-200 px-2.5 py-1 text-xs dark:border-slate-700"
                >
                  <Lightbulb className="h-3.5 w-3.5" />
                  {action.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <textarea
                ref={inputRef}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                rows={3}
                maxLength={20_000}
                placeholder="输入你的问题或回答…"
                className="form-input resize-none pr-12"
                aria-label="学习消息"
                disabled={chatMutation.isPending}
              />
              <button
                type="button"
                onClick={submit}
                disabled={!message.trim() || chatMutation.isPending}
                className="absolute bottom-3 right-3 rounded-lg bg-[#3157D5] p-2 text-white hover:bg-[#2446B8] disabled:opacity-40"
                aria-label="发送学习消息"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowAttachments((value) => !value)}
                  disabled={chatMutation.isPending}
                  className="quiet-button min-h-8 px-2 text-xs"
                  aria-expanded={showAttachments}
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  选择已有资料
                  {attachments.length > 0 && (
                    <span className="rounded-full bg-indigo-100 px-1.5 text-[10px] text-indigo-700">
                      {attachments.length}
                    </span>
                  )}
                  <ChevronDown className="h-3 w-3" />
                </button>
                {showAttachments && !chatMutation.isPending && (
                  <AttachmentMenu
                    documents={availableDocuments}
                    selected={attachments}
                    onToggle={toggleAttachment}
                  />
                )}
              </div>
              <button
                type="button"
                onClick={() => uploadInputRef.current?.click()}
                disabled={chatMutation.isPending || uploadOperation?.pending}
                className="quiet-button min-h-8 px-2 text-xs"
              >
                <Upload className="h-3.5 w-3.5" />
                上传资料
              </button>
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={chatMutation.isPending || uploadOperation?.pending}
                className="quiet-button min-h-8 px-2 text-xs"
              >
                <Camera className="h-3.5 w-3.5" />
                拍照
              </button>
              <input
                ref={uploadInputRef}
                type="file"
                accept={acceptedMaterialTypes}
                disabled={chatMutation.isPending}
                className="sr-only"
                aria-label="上传学习资料"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void processUpload(file);
                  event.currentTarget.value = "";
                }}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/png,image/jpeg,image/tiff"
                capture="environment"
                disabled={chatMutation.isPending}
                className="sr-only"
                aria-label="拍照上传学习资料"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void processUpload(file);
                  event.currentTarget.value = "";
                }}
              />
              <span className="ml-auto text-[10px] text-slate-400">
                Enter 发送 · Shift+Enter 换行
              </span>
            </div>

            {uploadOperation && (
              <UploadStatus operation={uploadOperation} />
            )}
            {attachments.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2" aria-label="本轮附件">
                {attachments.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {availableDocuments.find((document) => document.id === id)
                      ?.filename ?? id.slice(0, 8)}
                    <button
                      type="button"
                      onClick={() => toggleAttachment(id)}
                      aria-label={`移除附件 ${id}`}
                      className="rounded focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4" aria-label="学习模型与证据">
          <ContextPanel title="掌握度与置信度">
            {latestResult ? (
              <MasteryBar
                value={latestResult.learner_update.mastery_score}
                confidence={latestResult.learner_update.confidence}
                label="本轮掌握度"
              />
            ) : (
              <PanelEmpty text="完成一轮学习后显示服务器评估。" />
            )}
          </ContextPanel>

          <ContextPanel title="本轮模型变化">
            {latestResult ? (
              <div className="space-y-2 text-xs">
                <p className="font-medium text-slate-700 dark:text-slate-200">
                  {learnerDecisionLabel(latestResult.learner_update.decision)}
                </p>
                <p className="leading-5 text-slate-500">
                  {latestResult.learner_update.reason}
                </p>
                <p className="text-slate-400">
                  当前认知层级 L{latestResult.learner_update.current_level}
                </p>
              </div>
            ) : (
              <PanelEmpty text="尚无学习者模型变化。" />
            )}
          </ContextPanel>

          <ContextPanel title="误解">
            <PanelEmpty text="当前聊天响应未提供结构化误解列表；不会从讲解文本猜测。" />
          </ContextPanel>

          <ContextPanel title="来源">
            {latestResult && latestResult.sources.length > 0 ? (
              <SourceList sources={latestResult.sources} />
            ) : (
              <PanelEmpty text="本轮没有返回来源。" />
            )}
          </ContextPanel>

          <ContextPanel title="工具调用">
            {latestResult?.tool_usage ? (
              <div className="space-y-2 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <Wrench className="h-3.5 w-3.5 text-[#3157D5]" />
                  {latestResult.tool_usage.enabled
                    ? `${latestResult.tool_usage.steps} 个受控步骤`
                    : "本轮未启用工具"}
                </div>
                {latestResult.tool_usage.tools.length > 0 && (
                  <ul className="space-y-1">
                    {latestResult.tool_usage.tools.map((tool, index) => (
                      <li key={`${tool}-${index}`}>{toolNameLabel(tool)}</li>
                    ))}
                  </ul>
                )}
                {latestResult.tool_usage.fallback && (
                  <p className="text-amber-600">本轮使用了安全回退路径。</p>
                )}
              </div>
            ) : (
              <PanelEmpty text="本轮没有工具调用摘要。" />
            )}
          </ContextPanel>

          <ContextPanel title="图谱更新">
            {latestResult ? (
              <GraphUpdateSummary result={latestResult} />
            ) : (
              <PanelEmpty text="尚无领域或学生图谱变化。" />
            )}
          </ContextPanel>

          <ContextPanel title="本地教学偏好">
            <dl className="grid grid-cols-2 gap-2 text-[11px] text-slate-500">
              <dt>讲解详细度</dt>
              <dd className="text-right">
                {preferences.explanationDetail === "concise"
                  ? "简洁"
                  : preferences.explanationDetail === "detailed"
                    ? "详细"
                    : "平衡"}
              </dd>
              <dt>优先示例</dt>
              <dd className="text-right">
                {preferences.prioritizeExamples ? "是" : "否"}
              </dd>
              <dt>提示强度</dt>
              <dd className="text-right">
                {preferences.hintStrength === "light"
                  ? "轻"
                  : preferences.hintStrength === "strong"
                    ? "强"
                    : "平衡"}
              </dd>
              <dt>复习频率</dt>
              <dd className="text-right">
                {preferences.reviewFrequency === "daily"
                  ? "每天"
                  : preferences.reviewFrequency === "weekly"
                    ? "每周一次"
                    : "每周两次"}
              </dd>
            </dl>
            <p className="mt-2 text-[10px] leading-4 text-slate-400">
              这些是本设备偏好，只影响模式默认值、快捷提示与界面说明，不会伪装成服务器设置。
            </p>
          </ContextPanel>
        </aside>
      </div>
    </div>
  );
}

function UserTurn({ message }: { message: ConversationMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] rounded-2xl bg-[#3157D5] px-4 py-3 text-sm leading-7 text-white">
        <p className="whitespace-pre-wrap">{message.text}</p>
        {message.attachmentNames && message.attachmentNames.length > 0 && (
          <p className="mt-2 border-t border-white/20 pt-2 text-[11px] text-indigo-100">
            附件：{message.attachmentNames.join("、")}
          </p>
        )}
      </div>
    </div>
  );
}

export function TeachingTurn({ result }: { result: ChatResponse }) {
  return (
    <article className="space-y-3" aria-label="教师教学响应">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-[#3157D5] dark:bg-indigo-950">
          <Sparkles className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold">教师讲解</span>
        <CognitiveBadge level={result.cognitive_level} />
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {teachingActionLabel(result.teaching_action)}
        </span>
      </div>
      <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-700 dark:bg-slate-800/70">
        <p className="mb-2 text-[11px] text-slate-400">
          目标知识点 · {result.target_knowledge_point.name}
        </p>
        <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-200">
          {result.response}
        </p>
      </section>
      <section
        className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/20"
        aria-label="掌握检测"
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-amber-600" />
          <h3 className="text-xs font-semibold text-amber-900 dark:text-amber-200">
            唯一掌握检测 · {assessmentTypeLabel(result.assessment.type)}
          </h3>
        </div>
        <p className="mt-2 text-sm leading-6 text-amber-900/80 dark:text-amber-100/80">
          {result.assessment.question}
        </p>
      </section>
    </article>
  );
}

function AttachmentMenu({
  documents,
  selected,
  onToggle,
}: {
  documents: ReturnType<typeof documentsForWorkspace>;
  selected: UUID[];
  onToggle: (id: UUID) => void;
}) {
  return (
    <div className="absolute bottom-10 left-0 z-20 w-80 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      {documents.length === 0 ? (
        <p className="px-3 py-4 text-xs text-slate-500">
          本设备还没有该 Workspace 的资料索引。
        </p>
      ) : (
        <>
          <p className="px-3 pb-2 text-[10px] leading-4 text-slate-400">
            后端聊天契约会在发送时摄取尚未摄取的附件。
          </p>
          {documents.map((document) => (
            <button
              type="button"
              key={document.id}
              onClick={() => onToggle(document.id)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:hover:bg-indigo-950/50"
              aria-pressed={selected.includes(document.id)}
            >
              <span
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded border",
                  selected.includes(document.id)
                    ? "border-[#3157D5] bg-[#3157D5] text-white"
                    : "border-slate-300",
                )}
              >
                {selected.includes(document.id) && (
                  <CheckCircle2 className="h-3 w-3" />
                )}
              </span>
              <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate">
                {document.filename}
              </span>
              <span className="text-[9px] text-slate-400">
                {document.status === "INGESTED" ? "已摄取" : "发送时摄取"}
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

function UploadStatus({ operation }: { operation: UploadOperation }) {
  const stageLabels: Record<UploadStage, string> = {
    upload: "上传",
    ingest: "摄取",
    attachment: "加入附件",
  };
  if (operation.error) {
    return (
      <div
        className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
        role="alert"
      >
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {stageLabels[operation.stage]}失败 · {operation.fileName}：
          {operation.error instanceof Error
            ? operation.error.message
            : "请求失败，请重试。"}
        </span>
      </div>
    );
  }
  return (
    <div
      className="mt-3 flex items-center gap-2 text-xs text-slate-500"
      role="status"
    >
      {operation.pending ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
      )}
      {operation.pending
        ? `正在${stageLabels[operation.stage]} ${operation.fileName}…`
        : `${operation.fileName} 已完成摄取并加入本轮附件`}
    </div>
  );
}

function SourceList({ sources }: { sources: JsonObject[] }) {
  return (
    <ul className="space-y-2">
      {sources.map((source, index) => {
        const excerpt =
          typeof source.excerpt === "string" && source.excerpt.trim()
            ? source.excerpt
            : `来源 ${index + 1}`;
        const page =
          typeof source.page_number === "number"
            ? `第 ${source.page_number} 页`
            : null;
        const documentId =
          typeof source.document_id === "string" ? source.document_id : null;
        const sourceId =
          typeof source.source_span_id === "string"
            ? source.source_span_id
            : `source-${index}`;
        return (
          <li
            key={sourceId}
            className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500 dark:bg-slate-800/60"
          >
            <p className="line-clamp-3">{excerpt}</p>
            {(page || documentId) && (
              <p className="mt-1 text-[10px] text-slate-400">
                {[page, documentId ? `文档 ${documentId.slice(0, 8)}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function GraphUpdateSummary({ result }: { result: ChatResponse }) {
  return (
    <div className="space-y-3 text-xs text-slate-500">
      <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
        <div className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
          <Layers3 className="h-3.5 w-3.5 text-[#3157D5]" />
          领域知识图谱
        </div>
        <p className="mt-2">
          新增 {result.graph_update.nodes_added} 个节点 · 新增 {result.graph_update.assertions_added} 条关系 · 替代 {result.graph_update.assertions_superseded} 条关系
        </p>
        <p className="mt-1 font-mono text-[10px] text-slate-400">
          {result.graph_update.revision_id
            ? `版本 ${result.graph_update.revision_id.slice(0, 8)}`
            : "本轮没有领域版本"}
        </p>
      </div>
      <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
        <p className="font-medium text-slate-700 dark:text-slate-200">
          学生知识图谱
        </p>
        {result.learner_graph_update ? (
          <>
            <p className="mt-2">
              新增 {result.learner_graph_update.assertions_added} 条关系 · 替代 {result.learner_graph_update.assertions_superseded} 条关系
            </p>
            <p className="mt-1 font-mono text-[10px] text-slate-400">
              版本 {result.learner_graph_update.revision_id.slice(0, 8)}
            </p>
          </>
        ) : (
          <p className="mt-2 text-slate-400">本轮没有学生图谱版本。</p>
        )}
      </div>
    </div>
  );
}

function PanelEmpty({ text }: { text: string }) {
  return <p className="text-xs leading-5 text-slate-400">{text}</p>;
}

function ContextPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      {children}
    </div>
  );
}
