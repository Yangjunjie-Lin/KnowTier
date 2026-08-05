import { useQueryClient, useMutation } from "@tanstack/react-query";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  FileText,
  LoaderCircle,
  Paperclip,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api } from "@/services/api";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import type { ChatResponse, RequestedMode } from "@/types/api";
import { useAppStore, documentsForWorkspace } from "@/stores/AppContext";
import {
  CognitiveBadge,
  MasteryBar,
} from "@/components/shared/LearningVisuals";
import { EmptyState, ErrorState } from "@/components/shared/States";
import { PageHeader } from "@/components/shared/PageHeader";

interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  result?: ChatResponse;
}
const modes: Array<{ id: RequestedMode; label: string; description: string }> =
  [
    { id: "learn", label: "学习", description: "循序讲解与诊断" },
    { id: "review", label: "复习", description: "回顾与间隔复习" },
    { id: "practice", label: "练习", description: "给出练习并反馈" },
    { id: "exam", label: "考试", description: "减少提示，检验掌握" },
    { id: "research", label: "研究", description: "跨来源探索关系" },
  ];

export function LearnPage() {
  const {
    currentWorkspace,
    currentLearner,
    sessionId,
    recentDocuments,
    newSession,
  } = useAppStore();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<RequestedMode>("learn");
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [showAttachments, setShowAttachments] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const availableDocuments = useMemo(
    () => documentsForWorkspace(recentDocuments, currentWorkspace?.id),
    [currentWorkspace?.id, recentDocuments],
  );
  const chatMutation = useMutation({
    mutationFn: (input: { text: string; attachmentIds: string[] }) =>
      api.chat({
        workspace_id: currentWorkspace!.id,
        learner_id: currentLearner!.id,
        session_id: sessionId,
        message: input.text,
        attachment_ids: input.attachmentIds,
        requested_mode: mode,
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
      setAttachments([]);
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

  if (!currentWorkspace || !currentLearner)
    return (
      <EmptyState
        title="请先完成初始化"
        description="学习空间需要当前 Workspace 和学习者。"
      />
    );
  const submit = (options?: { retry?: boolean }) => {
    const text = message.trim();
    if (!text || chatMutation.isPending) return;
    const attachmentIds = [...attachments];
    if (!options?.retry) {
      setMessages((current) => [
        ...current,
        {
          id: `local-${crypto.randomUUID()}`,
          role: "user",
          text,
        },
      ]);
    }
    chatMutation.mutate({ text, attachmentIds });
  };
  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
      <PageHeader
        eyebrow="Learning space"
        title="学习空间"
        description="每次回答都会形成可追溯的掌握证据与图谱变化。"
        actions={
          <button
            type="button"
            onClick={() => {
              newSession();
              setMessages([]);
            }}
            className="secondary-button"
          >
            <RotateCcw className="h-4 w-4" />
            新建 Session
          </button>
        }
      />
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 dark:border-slate-800 dark:bg-slate-900">
        {modes.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => setMode(item.id)}
            className={cn(
              "min-w-20 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
              mode === item.id
                ? "bg-[#EEF2FF] text-[#3157D5] dark:bg-indigo-950/60 dark:text-indigo-300"
                : "text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800",
            )}
            aria-pressed={mode === item.id}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="grid flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="flex min-h-[560px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-[#3157D5] dark:bg-indigo-950">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-medium">
                  {modes.find((item) => item.id === mode)?.label}模式
                </p>
                <p className="text-[11px] text-slate-400">
                  Session{" "}
                  <span className="font-mono">{sessionId.slice(0, 8)}</span>
                </p>
              </div>
            </div>
            <span className="text-[11px] text-slate-400">非流式完整响应</span>
          </div>
          <div
            className="flex-1 space-y-5 overflow-y-auto p-5"
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <div className="flex h-full min-h-80 flex-col items-center justify-center text-center">
                <BookOpen className="h-8 w-8 text-[#7B96EF]" />
                <h2 className="mt-3 text-base font-medium">从一个问题开始</h2>
                <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">
                  输入你正在学习的内容，或直接附加资料。后端会根据真实图谱和个人模型选择教学动作。
                </p>
              </div>
            ) : (
              messages.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "flex gap-3",
                    item.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-7",
                      item.role === "user"
                        ? "bg-[#3157D5] text-white"
                        : "border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
                    )}
                  >
                    <p className="whitespace-pre-wrap">{item.text}</p>
                    {item.result && <ResponseInsight result={item.result} />}
                  </div>
                </div>
              ))
            )}
            {chatMutation.isPending && (
              <div
                className="flex items-center gap-2 text-sm text-slate-400"
                role="status"
              >
                <LoaderCircle className="h-4 w-4 animate-spin" />
                正在分析回答、更新掌握度与图谱…
              </div>
            )}
            {chatMutation.isError && (
              <ErrorState
                error={chatMutation.error}
                onRetry={() => submit({ retry: true })}
              />
            )}
          </div>
          <div className="border-t border-slate-100 p-4 dark:border-slate-800">
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
                onClick={() => submit()}
                disabled={!message.trim() || chatMutation.isPending}
                className="absolute bottom-3 right-3 rounded-lg bg-[#3157D5] p-2 text-white hover:bg-[#2446B8] disabled:opacity-40"
                aria-label="发送"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowAttachments((value) => !value)}
                  className="quiet-button min-h-8 px-2 text-xs"
                  aria-expanded={showAttachments}
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  附加资料
                  {attachments.length > 0 && (
                    <span className="rounded-full bg-indigo-100 px-1.5 text-[10px] text-indigo-700">
                      {attachments.length}
                    </span>
                  )}
                  <ChevronDown className="h-3 w-3" />
                </button>
                {showAttachments && (
                  <AttachmentMenu
                    documents={availableDocuments}
                    selected={attachments}
                    onToggle={(id) =>
                      setAttachments((current) =>
                        current.includes(id)
                          ? current.filter((value) => value !== id)
                          : [...current, id].slice(0, 20),
                      )
                    }
                  />
                )}
              </div>
              <span className="text-[10px] text-slate-400">
                Enter 发送 · Shift+Enter 换行
              </span>
            </div>
          </div>
        </section>
        <aside className="space-y-4">
          <ContextPanel title="本轮模式">
            <p className="text-sm font-medium">
              {modes.find((item) => item.id === mode)?.label}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {modes.find((item) => item.id === mode)?.description}
            </p>
          </ContextPanel>
          <ContextPanel title="附件">
            <p className="text-xs text-slate-500">
              {attachments.length
                ? `${attachments.length} 份资料将在本轮使用`
                : "尚未选择资料"}
            </p>
            {attachments.map((id) => (
              <div key={id} className="mt-2 flex items-center gap-2 text-xs">
                <FileText className="h-3.5 w-3.5 text-[#3157D5]" />
                {availableDocuments.find((document) => document.id === id)
                  ?.filename ?? id.slice(0, 8)}
                <button
                  type="button"
                  className="ml-auto text-slate-400"
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((value) => value !== id),
                    )
                  }
                  aria-label="移除附件"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </ContextPanel>
          <ContextPanel title="服务说明">
            <p className="text-xs leading-5 text-slate-500">
              回答完成后会刷新个人模型、学生图谱、领域 Manifest 和相关版本缓存。
            </p>
          </ContextPanel>
        </aside>
      </div>
    </div>
  );
}

function AttachmentMenu({
  documents,
  selected,
  onToggle,
}: {
  documents: ReturnType<typeof documentsForWorkspace>;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="absolute bottom-10 left-0 z-10 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      {documents.length === 0 ? (
        <p className="px-3 py-4 text-xs text-slate-500">
          本设备还没有上传资料。
        </p>
      ) : (
        documents.map((document) => (
          <button
            type="button"
            key={document.id}
            onClick={() => onToggle(document.id)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
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
            <span className="min-w-0 flex-1 truncate">{document.filename}</span>
          </button>
        ))
      )}
    </div>
  );
}

function ResponseInsight({ result }: { result: ChatResponse }) {
  return (
    <div className="mt-4 space-y-3 border-t border-slate-200/70 pt-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <CognitiveBadge level={result.cognitive_level} />
        <span className="rounded-md bg-white px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-900">
          {result.teaching_action}
        </span>
        <span className="text-[11px] text-slate-400">
          目标：{result.target_knowledge_point.name}
        </span>
      </div>
      <MasteryBar
        value={result.learner_update.mastery_score}
        confidence={result.learner_update.confidence}
        label="本轮掌握度"
      />
      <div className="rounded-lg bg-white/70 px-3 py-2 text-xs dark:bg-slate-900/60">
        <p className="font-medium text-slate-600 dark:text-slate-300">
          掌握检测 · {result.assessment.type}
        </p>
        <p className="mt-1 text-slate-500">{result.assessment.question}</p>
      </div>
      <div className="grid gap-2 text-[11px] text-slate-500 sm:grid-cols-2">
        <span>
          模型决策：
          <b className="text-slate-700 dark:text-slate-200">
            {result.learner_update.decision}
          </b>
        </span>
        <span>
          领域图谱：+{result.graph_update.nodes_added} 节点 / +
          {result.graph_update.assertions_added} 关系
        </span>
        {result.learner_graph_update && (
          <span>
            学生版本：{result.learner_graph_update.revision_id.slice(0, 8)}
          </span>
        )}
        {result.tool_usage && (
          <span>
            工具调用：{result.tool_usage.steps} 步
            {result.tool_usage.fallback ? "（回退）" : ""}
          </span>
        )}
      </div>
      {result.sources.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-slate-500">来源</p>
          <div className="mt-1 space-y-1">
            {result.sources.slice(0, 3).map((source, index) => (
              <div
                key={
                  typeof source.source_span_id === "string"
                    ? source.source_span_id
                    : String(index)
                }
                className="rounded bg-white/60 px-2 py-1 text-[11px] text-slate-500 dark:bg-slate-900/60"
              >
                {typeof source.excerpt === "string"
                  ? source.excerpt
                  : `来源 ${index + 1}`}{" "}
                {typeof source.page_number === "number"
                  ? `· p.${source.page_number}`
                  : ""}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
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
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      {children}
    </div>
  );
}
