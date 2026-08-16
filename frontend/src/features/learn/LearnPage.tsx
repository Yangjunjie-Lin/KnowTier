import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertCircle,
  BookOpen,
  Camera,
  CheckCircle2,
  ChevronDown,
  FileText,
  Lightbulb,
  LoaderCircle,
  Paperclip,
  PanelRightOpen,
  RotateCcw,
  Send,
  Sparkles,
  StopCircle,
  Upload,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LearningStatusSheet } from "@/components/learn/LearningStatusSheet";
import { PrerequisitePanel } from "@/components/learn/PrerequisitePanel";
import { TeachingResponse } from "@/components/learn/TeachingResponse";
import {
  CognitiveBadge,
  MasteryBar,
} from "@/components/shared/LearningVisuals";
import { EmptyState, ErrorState } from "@/components/shared/States";
import { PageHeader } from "@/components/shared/PageHeader";
import { RuntimeModelBadge } from "@/components/shared/RuntimeModelBadge";
import { useI18n } from "@/lib/i18n";
import { isApiError } from "@/lib/api/errors";
import type { PrerequisiteInsight } from "@/lib/learningInsights";
import {
  materialFileAccept,
  validateMaterialFile,
  type MaterialFileIssue,
} from "@/lib/materialFiles";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { api } from "@/services/api";
import { documentsForWorkspace, useAppStore } from "@/stores/AppContext";
import type {
  ChatResponse,
  ConversationHistoryResponse,
  JsonObject,
  RequestedMode,
  UUID,
} from "@/types/api";
import { recentDocumentFrom } from "@/types/app";
import type { LocalPreferences, UiLocale } from "@/types/app";
import { mergeQuickPrompt, quickTeachingActions } from "./quickTeachingActions";
import {
  assessmentTypeLabel,
  learnerDecisionLabel,
  teachingActionLabel,
  teachingModeLabel,
  teachingModes,
} from "./teachingLabels";
import {
  refreshLearningInsights,
  useLearningInsights,
} from "./useLearningInsights";

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
  file?: File;
  uploaded?: Awaited<ReturnType<typeof api.uploadDocument>>;
  stage: UploadStage;
  pending: boolean;
  error: unknown;
  retryable?: boolean;
}

interface ChatSubmission {
  clientRequestId: UUID;
  viewKey: string;
  text: string;
  attachmentIds: UUID[];
  requestedMode: RequestedMode;
  workspaceId: UUID;
  learnerId: UUID;
  sessionId: UUID;
}

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

export function learningTargetDraft(
  target: LearningTarget | null,
  locale: UiLocale = "zh-CN",
): string {
  if (!target) return "";
  return (
    target.prompt ??
    (locale === "en"
      ? `I want to learn “${target.name}”. Please confirm the learning goal with me before you begin.`
      : `我想学习“${target.name}”。请先和我确认学习目标，再开始讲解。`)
  );
}

function learningTargetSourceLabel(source: string, locale: UiLocale): string {
  const labels: Record<string, [string, string]> = {
    "domain-graph": ["领域知识图谱", "Domain map"],
    "student-graph": ["学生知识图谱", "Learner map"],
    "learning-path": ["学习路径", "Learning path"],
    "personal-model": ["我的进度", "My progress"],
    overview: ["学习总览", "Overview"],
    search: ["全局搜索", "Search"],
    "prerequisite-panel": ["前置知识", "Prerequisites"],
  };
  const label = labels[source];
  return (
    label?.[locale === "en" ? 1 : 0] ??
    (locale === "en" ? "Another learning view" : "其他学习页面")
  );
}

function quickActionContent(
  id: (typeof quickTeachingActions)[number]["id"],
  preferences: LocalPreferences,
  locale: UiLocale,
): { label: string; prompt: string } {
  if (locale !== "en") {
    const action = quickTeachingActions.find((item) => item.id === id)!;
    return { label: action.label, prompt: action.prompt(preferences) };
  }
  const actions = {
    "not-understood": {
      label: "I don't understand",
      prompt:
        "I did not understand the last explanation. Help me identify where I am stuck first.",
    },
    hint: {
      label: "Give me a hint",
      prompt:
        preferences.hintStrength === "light"
          ? "Give me only a directional hint without revealing the answer."
          : preferences.hintStrength === "strong"
            ? "Give me a more explicit, structured hint, but do not reveal the complete answer yet."
            : "Give me a step-by-step hint while leaving the key step for me to complete.",
    },
    "re-explain": {
      label: "Explain differently",
      prompt: `Explain this topic again ${
        preferences.explanationDetail === "concise"
          ? "more concisely"
          : preferences.explanationDetail === "detailed"
            ? "in more detail, step by step"
            : "from a different angle"
      }.`,
    },
    example: {
      label: "Show an example",
      prompt: preferences.prioritizeExamples
        ? "Start with a concrete example, then show how it maps to the concept."
        : "Give me a concrete example and explain why it fits this concept.",
    },
    prerequisites: {
      label: "Check prerequisites",
      prompt:
        "Check whether I am missing any prerequisites needed to understand this topic.",
    },
  } as const;
  return actions[id];
}

function normalizedContentLanguage(language: string | undefined): string | undefined {
  const candidate = language?.trim();
  return candidate && /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2}$/i.test(candidate)
    ? candidate
    : undefined;
}

function starterActionContent(locale: UiLocale): Array<{
  id: string;
  label: string;
  prompt: string;
}> {
  return locale === "en"
    ? [
        {
          id: "start-from-zero",
          label: "Start from zero",
          prompt: "I want to learn this from scratch: ",
        },
        {
          id: "check-foundation",
          label: "Check my foundation",
          prompt:
            "Before explaining, ask me a few simple questions to understand what I already know and decide where to begin.",
        },
        {
          id: "make-a-plan",
          label: "Make a learning plan",
          prompt:
            "Ask about my goal and available time, then help me create a practical learning plan.",
        },
      ]
    : [
        {
          id: "start-from-zero",
          label: "从零开始讲",
          prompt: "我想从零开始学习：",
        },
        {
          id: "check-foundation",
          label: "先了解我的基础",
          prompt: "讲解前，请先用几个简单问题了解我已经会什么，再决定从哪里开始。",
        },
        {
          id: "make-a-plan",
          label: "帮我制定学习计划",
          prompt: "请先询问我的学习目标和可用时间，再帮我制定一份可执行的学习计划。",
        },
      ];
}

function messagesFromHistory(
  history: ConversationHistoryResponse,
  documents: ReturnType<typeof documentsForWorkspace>,
  unknownAttachmentName: string,
): ConversationMessage[] {
  const namesById = new Map(
    documents.map((document) => [document.id, document.filename]),
  );
  return history.items.map((item) => {
    if (item.role === "assistant") {
      return {
        id: item.id,
        role: "assistant",
        text: item.response.response,
        result: item.response,
      };
    }
    const attachmentNames = item.attachment_ids.map(
      (attachmentId) => namesById.get(attachmentId) ?? unknownAttachmentName,
    );
    return {
      id: item.id,
      role: "user",
      text: item.content,
      ...(attachmentNames.length > 0 ? { attachmentNames } : {}),
    };
  });
}

export function LearnPage() {
  const { locale, pick } = useI18n();
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
  const navigate = useNavigate();
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
    learningTargetDraft(navigationTarget, locale),
  );
  const [attachments, setAttachments] = useState<UUID[]>([]);
  const attachmentIdsRef = useRef<UUID[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [bypassedHistorySessionId, setBypassedHistorySessionId] =
    useState<UUID | null>(null);
  const [showAttachments, setShowAttachments] = useState(false);
  const [uploadOperation, setUploadOperation] =
    useState<UploadOperation | null>(null);
  const [learningStatusOpen, setLearningStatusOpen] = useState(false);
  const [synchronizingInsightsTargetId, setSynchronizingInsightsTargetId] =
    useState<UUID | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachmentTriggerRef = useRef<HTMLButtonElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(288);
  const inFlightRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [requestCancelled, setRequestCancelled] = useState(false);
  const contextKey = `${currentWorkspace?.id ?? "none"}:${currentLearner?.id ?? "none"}:${sessionId}`;
  const isHistoryBypassed = bypassedHistorySessionId === sessionId;
  const previousContextRef = useRef(contextKey);
  const navigationTargetKey = navigationTarget
    ? `${navigationTarget.id ?? "name"}:${navigationTarget.name}:${navigationTarget.source ?? ""}`
    : "none";
  const previousNavigationTargetRef = useRef(navigationTargetKey);
  const viewKey = `${contextKey}:${navigationTargetKey}`;
  const activeViewRef = useRef(viewKey);
  const appliedHistoryRef = useRef<string | null>(null);
  activeViewRef.current = viewKey;
  const workspaceDocuments = useInfiniteQuery({
    queryKey: queryKeys.documents(currentWorkspace?.id ?? "none"),
    initialPageParam: 0,
    enabled: Boolean(currentWorkspace),
    queryFn: ({ signal, pageParam }) => {
      if (!currentWorkspace) {
        throw new Error("A workspace is required to load materials.");
      }
      return api.listDocuments(currentWorkspace.id, signal, pageParam);
    },
    getNextPageParam: (lastPage) => lastPage.next_offset ?? undefined,
  });
  const availableDocuments = useMemo(() => {
    const byId = new Map(recentDocuments.map((document) => [document.id, document]));
    for (const document of
      workspaceDocuments.data?.pages.flatMap((page) => page.items) ?? []) {
      byId.set(document.id, recentDocumentFrom(document));
    }
    return documentsForWorkspace([...byId.values()], currentWorkspace?.id);
  }, [currentWorkspace?.id, recentDocuments, workspaceDocuments.data?.pages]);
  const knownMaterialIds = useMemo(
    () => new Set(availableDocuments.map((document) => document.id)),
    [availableDocuments],
  );
  const conversationHistory = useQuery({
    queryKey: queryKeys.conversationHistory(
      currentWorkspace?.id ?? "none",
      currentLearner?.id ?? "none",
      sessionId,
    ),
    enabled: Boolean(currentWorkspace && currentLearner && !isHistoryBypassed),
    retry: false,
    queryFn: ({ signal }) => {
      const workspaceId = currentWorkspace?.id;
      const learnerId = currentLearner?.id;
      if (!workspaceId || !learnerId) {
        throw new Error("A workspace and learner are required to restore a conversation.");
      }
      return api.getConversationHistory(
        workspaceId,
        learnerId,
        sessionId,
        signal,
      );
    },
  });
  const isRestoringConversation =
    !isHistoryBypassed &&
    (conversationHistory.isPending ||
      (conversationHistory.isFetching &&
        conversationHistory.data === undefined));
  const historyBlocksComposer =
    isRestoringConversation ||
    (conversationHistory.isError && !isHistoryBypassed);
  const latestResult = useMemo(
    () =>
      [...messages].reverse().find((item) => item.result !== undefined)?.result,
    [messages],
  );
  const learningInsightsResult = useLearningInsights({
    workspaceId: currentWorkspace?.id,
    learnerId: currentLearner?.id,
    latestChatResponse: latestResult,
    navigationTarget,
    synchronizingTargetId: synchronizingInsightsTargetId,
  });

  const replaceAttachments = (next: UUID[]) => {
    attachmentIdsRef.current = next;
    setAttachments(next);
  };

  const chatMutation = useMutation({
    mutationFn: (input: ChatSubmission) => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      return api
        .chat(
          {
            workspace_id: input.workspaceId,
            learner_id: input.learnerId,
            session_id: input.sessionId,
            client_request_id: input.clientRequestId,
            message: input.text,
            attachment_ids: input.attachmentIds,
            requested_mode: input.requestedMode,
          },
          controller.signal,
        )
        .finally(() => {
          if (abortControllerRef.current !== controller) return;
          inFlightRef.current = false;
          abortControllerRef.current = null;
        });
    },
    onSuccess: async (result, input) => {
      if (input.viewKey !== activeViewRef.current) return;
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
      const targetId = result.target_knowledge_point.id;
      setSynchronizingInsightsTargetId(targetId);
      await Promise.allSettled([
        refreshLearningInsights(queryClient, {
          workspaceId: input.workspaceId,
          learnerId: input.learnerId,
          targetId,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.learnerRevisions(input.learnerId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.manifest(input.workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.domainGraph(input.workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.domainRevisions(input.workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: ["learning-path", input.learnerId],
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.conversationHistory(
            input.workspaceId,
            input.learnerId,
            input.sessionId,
          ),
          refetchType: "none",
        }),
      ]);
      setSynchronizingInsightsTargetId((current) =>
        current === targetId ? null : current,
      );
    },
  });

  useEffect(() => {
    if (previousContextRef.current === contextKey) return;
    previousContextRef.current = contextKey;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    inFlightRef.current = false;
    chatMutation.reset();
    setMessages([]);
    setMessage("");
    attachmentIdsRef.current = [];
    setAttachments([]);
    setShowAttachments(false);
    setUploadOperation(null);
    setNavigationTargetConfirmed(false);
    setSynchronizingInsightsTargetId(null);
    setLearningStatusOpen(false);
    setRequestCancelled(false);
  }, [chatMutation, contextKey]);

  useEffect(() => {
    if (previousNavigationTargetRef.current === navigationTargetKey) return;
    previousNavigationTargetRef.current = navigationTargetKey;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    inFlightRef.current = false;
    chatMutation.reset();
    attachmentIdsRef.current = [];
    setAttachments([]);
    setShowAttachments(false);
    setUploadOperation(null);
    setNavigationTargetConfirmed(false);
    setSynchronizingInsightsTargetId(null);
    setLearningStatusOpen(false);
    setMessage(learningTargetDraft(navigationTarget, locale));
    setRequestCancelled(false);
  }, [chatMutation, locale, navigationTarget, navigationTargetKey]);

  useEffect(() => {
    if (!conversationHistory.data) return;
    const applicationKey = `${contextKey}:${conversationHistory.dataUpdatedAt}:${workspaceDocuments.dataUpdatedAt}`;
    if (appliedHistoryRef.current === applicationKey) return;
    appliedHistoryRef.current = applicationKey;
    const restored = messagesFromHistory(
      conversationHistory.data,
      availableDocuments,
      pick("历史资料", "Previous material"),
    );
    const restoredById = new Map(restored.map((item) => [item.id, item]));
    setMessages((current) => {
      const hasLocalMessages = current.some((item) => !restoredById.has(item.id));
      return hasLocalMessages
        ? current.map((item) => restoredById.get(item.id) ?? item)
        : restored;
    });
  }, [
    availableDocuments,
    contextKey,
    conversationHistory.data,
    conversationHistory.dataUpdatedAt,
    pick,
    workspaceDocuments.dataUpdatedAt,
  ]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const updateHeight = () => {
      const next = Math.ceil(composer.getBoundingClientRect().height);
      if (next > 0) setComposerHeight(next);
    };
    updateHeight();
    if (!("ResizeObserver" in window)) return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(composer);
    return () => observer.disconnect();
  }, [currentLearner?.id, currentWorkspace?.id, historyBlocksComposer]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView?.({
      block: "nearest",
      behavior: preferences.reducedMotion ? "auto" : "smooth",
    });
  }, [chatMutation.isPending, messages.length, preferences.reducedMotion]);

  if (!currentWorkspace || !currentLearner) {
    return (
      <EmptyState
        title={pick("请先完成初始化", "Complete setup first")}
        description={pick(
          "请先选择学习空间和学习者，再开始学习。",
          "Choose a workspace and learner before starting a lesson.",
        )}
        action={
          <Link to="/init" className="primary-button">
            {pick("开始初始化", "Start setup")}
          </Link>
        }
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
        fileName: pick("附件", "Attachments"),
        stage: "attachment",
        pending: false,
        error: new Error("attachment-limit"),
      });
      return;
    }
    replaceAttachments([...current, id]);
  };

  const closeAttachmentMenu = () => {
    setShowAttachments(false);
    window.requestAnimationFrame(() => attachmentTriggerRef.current?.focus());
  };

  const processUpload = async (
    file: File,
    resumeUploaded?: Awaited<ReturnType<typeof api.uploadDocument>>,
  ) => {
    if (chatMutation.isPending || uploadOperation?.pending) return;
    if (!resumeUploaded) {
      const issue = validateMaterialFile(file);
      if (issue) {
        setUploadOperation({
          fileName: file.name,
          file,
          stage: "upload",
          pending: false,
          error: new Error(`material-file-${issue}`),
          retryable: false,
        });
        return;
      }
    }
    const operationViewKey = viewKey;
    setUploadOperation({
      fileName: file.name,
      file,
      ...(resumeUploaded ? { uploaded: resumeUploaded } : {}),
      stage: resumeUploaded ? "ingest" : "upload",
      pending: true,
      error: null,
    });
    let uploaded = resumeUploaded;
    if (!uploaded) {
      try {
        uploaded = await api.uploadDocument(currentWorkspace.id, file);
        if (operationViewKey !== activeViewRef.current) return;
        rememberDocument(uploaded);
      } catch (error) {
        if (operationViewKey !== activeViewRef.current) return;
        setUploadOperation({
          fileName: file.name,
          file,
          stage: "upload",
          pending: false,
          error,
          retryable: !(isApiError(error) && error.status === 422),
        });
        return;
      }
    }

    if (uploaded.status !== "INGESTED") {
      setUploadOperation({
        fileName: file.name,
        file,
        uploaded,
        stage: "ingest",
        pending: true,
        error: null,
      });
      try {
        await api.ingestDocument(uploaded.id);
        if (operationViewKey !== activeViewRef.current) return;
        rememberDocument({ ...uploaded, status: "INGESTED" });
      } catch (error) {
        if (operationViewKey !== activeViewRef.current) return;
        setUploadOperation({
          fileName: file.name,
          file,
          uploaded,
          stage: "ingest",
          pending: false,
          error,
        });
        return;
      }
    }

    if (operationViewKey !== activeViewRef.current) return;
    const current = attachmentIdsRef.current;
    if (!current.includes(uploaded.id) && current.length >= 20) {
      setUploadOperation({
        fileName: file.name,
        file,
        uploaded,
        stage: "attachment",
        pending: false,
        error: new Error("processed-attachment-limit"),
      });
      return;
    }
    if (!current.includes(uploaded.id)) {
      replaceAttachments([...current, uploaded.id]);
    }
    setUploadOperation({
      fileName: file.name,
      file,
      uploaded,
      stage: "attachment",
      pending: false,
      error: null,
    });
  };

  const submit = () => {
    const text = message.trim();
    if (
      !text ||
      inFlightRef.current ||
      chatMutation.isPending ||
      (!conversationHistory.isSuccess && !isHistoryBypassed)
    )
      return;
    inFlightRef.current = true;
    setRequestCancelled(false);
    const attachmentIds = [...attachmentIdsRef.current];
    const attachmentNames = attachmentIds.map(
      (id) =>
        availableDocuments.find((document) => document.id === id)?.filename ??
        pick("未命名资料", "Untitled material"),
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
    chatMutation.mutate({
      clientRequestId: crypto.randomUUID(),
      viewKey,
      text,
      attachmentIds,
      requestedMode: mode,
      workspaceId: currentWorkspace.id,
      learnerId: currentLearner.id,
      sessionId,
    });
  };

  const retryLastSubmission = () => {
    if (!chatMutation.variables || inFlightRef.current) return;
    inFlightRef.current = true;
    setRequestCancelled(false);
    chatMutation.mutate(chatMutation.variables);
  };

  const cancelSubmission = () => {
    if (!chatMutation.isPending) return;
    setRequestCancelled(true);
    abortControllerRef.current?.abort(
      new DOMException("The teaching request was cancelled.", "AbortError"),
    );
  };

  const beginNewSession = (bypassHistory: boolean) => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    inFlightRef.current = false;
    chatMutation.reset();
    const nextSessionId = newSession();
    setBypassedHistorySessionId(bypassHistory ? nextSessionId : null);
    setMessages([]);
    setMessage("");
    replaceAttachments([]);
    setShowAttachments(false);
    setUploadOperation(null);
    setNavigationTargetConfirmed(false);
    setSynchronizingInsightsTargetId(null);
    setLearningStatusOpen(false);
    setRequestCancelled(false);
    if (uploadInputRef.current) uploadInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    void navigate("/learn", { replace: true, state: null });
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const resetLearningSession = () => {
    const hasLocalContent =
      messages.length > 0 ||
      Boolean(message.trim()) ||
      attachments.length > 0 ||
      uploadOperation !== null;
    if (
      hasLocalContent &&
      !window.confirm(
        pick(
          "开始新会话？当前对话、草稿与本轮附件会从页面清除。已写入的学习数据不会删除。",
          "Start a new session? This conversation, draft, and turn attachments will be cleared. Saved learning records will remain.",
        ),
      )
    ) {
      return;
    }
    // A generated UUID cannot have earlier turns. Avoid making a blank
    // session depend on the history endpoint being available.
    beginNewSession(true);
  };

  const startPrerequisite = (item: PrerequisiteInsight) => {
    const target: LearningTarget = {
      id: item.id,
      name: item.name,
      source: "prerequisite-panel",
    };
    void navigate("/learn", { state: { learningTarget: target } });
    setNavigationTargetConfirmed(false);
    setSynchronizingInsightsTargetId(null);
    setMessage(learningTargetDraft(target, locale));
    setLearningStatusOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const currentKnowledgePoint =
    learningInsightsResult.insights.targetKnowledgePoint?.name;
  const { insights, panels: insightPanels } = learningInsightsResult;
  const hasPrerequisites = insights.prerequisites.length > 0;
  const misconceptionCount =
    insights.misconceptions.current.length +
    insights.misconceptions.history.length;
  const hasMisconceptions = misconceptionCount > 0;
  const hasEvidence = insights.evidence.length > 0;
  const hasInsightFailure = Boolean(
    insightPanels.prerequisites.error ||
    insightPanels.misconceptions.error ||
    insightPanels.evidence.error,
  );
  const isUpdatingInsights = Boolean(
    insights.targetKnowledgePoint &&
    (insightPanels.prerequisites.isLoading ||
      insightPanels.prerequisites.isRefreshing ||
      insightPanels.misconceptions.isLoading ||
      insightPanels.misconceptions.isRefreshing ||
      insightPanels.evidence.isLoading ||
      insightPanels.evidence.isRefreshing),
  );
  const hasLearningDetails = Boolean(
    latestResult ||
    hasPrerequisites ||
    hasMisconceptions ||
    hasEvidence ||
    hasInsightFailure ||
    isUpdatingInsights,
  );
  const hasProgressColumn = Boolean(
    latestResult || hasMisconceptions || hasEvidence || hasInsightFailure,
  );
  const firstTurnWithoutTarget = messages.length === 0 && !navigationTarget;
  const composerActions = firstTurnWithoutTarget
    ? starterActionContent(locale)
    : quickTeachingActions.map((action) => ({
        id: action.id,
        ...quickActionContent(action.id, preferences, locale),
      }));
  const retryUpload = (() => {
    const operation = uploadOperation;
    const file = operation?.file;
    if (
      !operation ||
      !file ||
      operation.stage === "attachment" ||
      operation.retryable === false
    )
      return undefined;
    return () =>
      void processUpload(
        file,
        operation.stage === "ingest" ? operation.uploaded : undefined,
      );
  })();

  return (
    <div
      className="min-h-[calc(100vh-8rem)]"
      style={
        {
          "--learn-composer-height": historyBlocksComposer
            ? "0px"
            : `${composerHeight}px`,
        } as CSSProperties
      }
    >
      <PageHeader
        eyebrow={pick("智能教学工作台", "AI learning workspace")}
        title={pick("开始学习", "Learning")}
        description={pick(
          "围绕一个目标持续提问、练习并检查理解。",
          "Ask questions, practise, and check your understanding around one goal.",
        )}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {hasLearningDetails && (
              <button
                type="button"
                onClick={() => setLearningStatusOpen(true)}
                className="secondary-button xl:hidden"
                aria-haspopup="dialog"
              >
                <PanelRightOpen className="h-4 w-4" />
                {pick("学习状态", "Learning status")}
              </button>
            )}
            <button
              type="button"
              onClick={resetLearningSession}
              disabled={chatMutation.isPending}
              className="secondary-button"
            >
              <RotateCcw className="h-4 w-4" />
              {pick("新建会话", "New session")}
            </button>
          </div>
        }
      />
      <div className="mb-4">
        <RuntimeModelBadge
          role="teacher"
          label={pick("教学模型", "Teaching model")}
        />
      </div>

      <div
        className={cn(
          "grid gap-4",
          hasProgressColumn
            ? "xl:grid-cols-[220px_minmax(0,1fr)_280px]"
            : "xl:grid-cols-[220px_minmax(0,1fr)]",
        )}
      >
        <aside
          className="hidden space-y-4 xl:block"
          aria-label={pick("教学上下文", "Learning context")}
        >
          <ContextPanel title={pick("学习焦点", "Learning focus")}>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {currentKnowledgePoint ??
                navigationTarget?.name ??
                pick("自由提问", "Open question")}
            </p>
            {navigationTarget ? (
              <div className="mt-2 space-y-2">
                <span
                  className={cn(
                    "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                    navigationTargetConfirmed
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
                  )}
                >
                  {navigationTargetConfirmed
                    ? pick("已发送确认请求", "Confirmation sent")
                    : pick("等待你确认", "Waiting for confirmation")}
                </span>
                {navigationTarget.source && (
                  <p className="text-[11px] text-slate-600 dark:text-slate-400">
                    {pick("来自：", "From: ")}
                    {learningTargetSourceLabel(navigationTarget.source, locale)}
                  </p>
                )}
                <p className="text-xs leading-5 text-slate-500">
                  {pick(
                    "发送预填问题后开始围绕这个目标学习。",
                    "Send the prepared question to start learning this topic.",
                  )}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {pick(
                  "直接输入想学的内容，系统会在对话中确认知识点。",
                  "Type what you want to learn. The tutor will confirm the topic in the conversation.",
                )}
              </p>
            )}
            <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
              <label
                className="mb-1.5 block text-[11px] font-medium text-slate-500"
                htmlFor="teaching-mode"
              >
                {pick("教学方式", "Teaching mode")}
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
                    {locale === "en" ? item.labelEn : item.label} ·{" "}
                    {locale === "en" ? item.descriptionEn : item.description}
                  </option>
                ))}
              </select>
              <Link
                to="/settings"
                className="mt-2 inline-flex text-[11px] font-medium text-[#3157D5] hover:underline"
              >
                {pick("调整教学偏好", "Adjust teaching preferences")}
              </Link>
            </div>
          </ContextPanel>

          {hasPrerequisites && (
            <PrerequisitePanel
              target={insights.targetKnowledgePoint}
              items={insights.prerequisites}
              structureSource={insights.prerequisiteStructureSource}
              state={insightPanels.prerequisites}
              onStart={startPrerequisite}
            />
          )}
        </aside>

        <section className="grid min-h-[520px] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none lg:min-h-[480px] xl:h-[calc(100dvh-16.5rem)] xl:min-h-[560px] xl:max-h-[760px] xl:self-start">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800 sm:px-5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-[#3157D5] dark:bg-indigo-950">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {pick("AI 教学对话", "AI tutoring conversation")}
                </p>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  {pick(
                    "讲解之后，用一个问题检查理解",
                    "One question checks understanding after each explanation",
                  )}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden text-[11px] text-slate-600 dark:text-slate-400 sm:inline">
                {currentKnowledgePoint ??
                  pick("还未选择知识点", "No topic yet")}
              </span>
              <span className="hidden text-[11px] text-slate-600 dark:text-slate-400 xl:inline">
                · {teachingModeLabel(mode, locale)}
              </span>
              <label className="xl:hidden">
                <span className="sr-only">
                  {pick("教学模式（紧凑）", "Teaching mode (compact)")}
                </span>
                <select
                  value={mode}
                  onChange={(event) =>
                    setMode(event.target.value as RequestedMode)
                  }
                  className="form-input min-h-8 py-1 text-xs"
                  aria-label={pick(
                    "教学模式（紧凑）",
                    "Teaching mode (compact)",
                  )}
                >
                  {teachingModes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {locale === "en" ? item.labelEn : item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div
            className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 pb-[calc(var(--learn-composer-height)+1rem)] sm:p-5 xl:pb-5"
            tabIndex={0}
            aria-label={pick("学习对话记录", "Learning conversation")}
            aria-live="polite"
            aria-busy={chatMutation.isPending || isRestoringConversation}
          >
            {conversationHistory.data?.truncated && !isHistoryBypassed && (
              <p
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
                role="status"
              >
                {pick(
                  `为保持页面流畅，仅恢复最近 ${conversationHistory.data.turn_limit} 条对话消息。`,
                  `For a responsive page, only the most recent ${conversationHistory.data.turn_limit} conversation messages were restored.`,
                )}
              </p>
            )}
            {isRestoringConversation ? (
              <div
                className="flex min-h-48 items-center justify-center gap-3 text-sm text-slate-600 sm:min-h-80 dark:text-slate-300"
                role="status"
              >
                <LoaderCircle className="h-5 w-5 animate-spin text-[#3157D5]" />
                {pick(
                  "正在恢复这段学习对话…",
                  "Restoring this learning conversation…",
                )}
              </div>
            ) : conversationHistory.isError && !isHistoryBypassed ? (
              <div
                className="mx-auto flex min-h-48 max-w-md flex-col items-center justify-center text-center sm:min-h-80"
                role="alert"
              >
                <AlertCircle className="h-8 w-8 text-red-500" />
                <h2 className="mt-3 text-base font-medium">
                  {pick("暂时无法恢复对话", "Conversation could not be restored")}
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  {pick(
                    "请重试加载；如果想从头开始，也可以新建会话。",
                    "Retry loading, or start a new session if you want a clean slate.",
                  )}
                </p>
                <button
                  type="button"
                  className="secondary-button mt-4"
                  onClick={() => void conversationHistory.refetch()}
                >
                  <RotateCcw className="h-4 w-4" />
                  {pick("重试加载对话", "Retry conversation")}
                </button>
                <button
                  type="button"
                  className="quiet-button mt-2"
                  onClick={() => beginNewSession(true)}
                >
                  {pick(
                    "跳过历史并新建空白会话",
                    "Skip history and start a blank session",
                  )}
                </button>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex min-h-48 flex-col items-center justify-start pt-8 text-center sm:min-h-80 sm:justify-center sm:pt-0">
                <BookOpen className="h-8 w-8 text-[#7B96EF]" />
                <h2 className="mt-3 text-base font-medium">
                  {pick(
                    "从一个知识点或问题开始",
                    "Start with a topic or question",
                  )}
                </h2>
                <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">
                  {pick(
                    "可以点击下方的起步选项，也可以直接提问或上传资料。每轮讲解后会用一个问题帮助你确认理解。",
                    "Choose a starter below, ask your own question, or add a material. Each explanation ends with one question to check your understanding.",
                  )}
                </p>
              </div>
            ) : (
              messages.map((item) =>
                item.role === "user" ? (
                  <UserTurn key={item.id} message={item} />
                ) : item.result ? (
                  <TeachingTurn
                    key={item.id}
                    result={item.result}
                    knownMaterialIds={knownMaterialIds}
                  />
                ) : null,
              )
            )}
            {chatMutation.isPending && (
              <div
                className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-3 text-sm text-indigo-800 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-200"
                role="status"
              >
                <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />
                <span className="min-w-0 flex-1">
                  {pick(
                    "正在生成讲解、检查掌握并同步学习模型…",
                    "Preparing an explanation, checking mastery, and updating your progress…",
                  )}
                </span>
                <button
                  type="button"
                  onClick={cancelSubmission}
                  className="quiet-button min-h-8 shrink-0 border border-indigo-200 bg-white px-2 text-xs dark:border-indigo-800 dark:bg-slate-900"
                >
                  <StopCircle className="h-3.5 w-3.5" />
                  {pick("取消", "Cancel")}
                </button>
              </div>
            )}
            {requestCancelled && !chatMutation.isPending && (
              <div
                role="status"
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <span className="min-w-[12rem] flex-1">
                  {pick(
                    "本轮请求已取消，草稿和附件仍保留。",
                    "This request was cancelled. Your draft and attachments are still here.",
                  )}
                </span>
                <button
                  type="button"
                  className="secondary-button min-h-8 px-3 py-1 text-xs"
                  onClick={retryLastSubmission}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {pick("重试本轮", "Retry this turn")}
                </button>
                <button
                  type="button"
                  className="quiet-button min-h-8 px-2 text-xs"
                  onClick={() => inputRef.current?.focus()}
                >
                  {pick("修改草稿", "Edit draft")}
                </button>
              </div>
            )}
            {chatMutation.isError && !requestCancelled && (
              <ErrorState
                error={chatMutation.error}
                onRetry={retryLastSubmission}
              />
            )}
            <div ref={messageEndRef} aria-hidden="true" />
          </div>

          {!historyBlocksComposer && (
            <div
              ref={composerRef}
              className="learn-composer fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 max-h-[calc(100dvh-7.5rem)] shrink-0 overflow-y-auto overscroll-contain border-t border-slate-200 bg-white/95 p-3 shadow-[0_-12px_30px_rgba(15,23,42,0.12)] backdrop-blur-xl transition-[left] duration-200 motion-reduce:transition-none dark:border-slate-800 dark:bg-slate-900/95 lg:bottom-0 lg:left-60 lg:right-0 xl:static xl:z-auto xl:max-h-none xl:overflow-visible xl:p-4 xl:shadow-none"
              aria-label={pick("学习消息编辑器", "Learning message editor")}
            >
            <div
              className="-mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              role="toolbar"
              aria-label={pick("快捷教学操作", "Quick teaching actions")}
              aria-describedby="quick-teaching-actions-help"
            >
              {composerActions.map((action) => {
                return (
                  <button
                    type="button"
                    key={action.id}
                    onClick={() => {
                      setMessage((current) =>
                        mergeQuickPrompt(current, action.prompt),
                      );
                      inputRef.current?.focus();
                    }}
                    disabled={chatMutation.isPending}
                    className="quiet-button min-h-9 shrink-0 border border-slate-200 px-2.5 py-1 text-xs dark:border-slate-700"
                  >
                    <Lightbulb className="h-3.5 w-3.5" />
                    {action.label}
                  </button>
                );
              })}
            </div>
            <span id="quick-teaching-actions-help" className="sr-only">
              {pick(
                firstTurnWithoutTarget
                  ? "选择一个起步方式会把可编辑的示例放入输入框。"
                  : "可横向滚动查看更多快捷操作。",
                firstTurnWithoutTarget
                  ? "Choose a starter to place an editable example in the message box."
                  : "Scroll horizontally for more quick actions.",
              )}
            </span>
            <div className="relative">
              <textarea
                ref={inputRef}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    submit();
                  }
                }}
                rows={3}
                maxLength={20_000}
                placeholder={pick(
                  firstTurnWithoutTarget
                    ? "例如：请从零讲解什么是机器学习"
                    : "输入你的问题或回答…",
                  firstTurnWithoutTarget
                    ? "For example: Teach me what machine learning is from scratch"
                    : "Type your question or answer…",
                )}
                className="form-input min-h-20 resize-none pr-12 text-base leading-6 sm:text-sm"
                aria-label={pick("学习消息", "Learning message")}
                aria-describedby="learning-message-help"
                disabled={chatMutation.isPending}
              />
              <button
                type="button"
                onClick={submit}
                disabled={
                  !message.trim() ||
                  chatMutation.isPending ||
                  (!conversationHistory.isSuccess && !isHistoryBypassed)
                }
                className="absolute bottom-2 right-2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#3157D5] text-white shadow-sm hover:bg-[#2446B8] focus:outline-none focus:ring-2 focus:ring-[#3157D5]/40 focus:ring-offset-2 disabled:opacity-40 dark:focus:ring-offset-slate-950"
                aria-label={pick("发送学习消息", "Send learning message")}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="relative">
                <button
                  ref={attachmentTriggerRef}
                  type="button"
                  onClick={() => setShowAttachments((value) => !value)}
                  disabled={chatMutation.isPending}
                  className="quiet-button min-h-8 px-2 text-xs"
                  aria-expanded={showAttachments}
                  aria-controls="learning-attachment-menu"
                  aria-haspopup="menu"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  {pick("选择已有资料", "Choose materials")}
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
                    loading={workspaceDocuments.isPending}
                    loadError={workspaceDocuments.isError}
                    hasMore={workspaceDocuments.hasNextPage}
                    loadingMore={workspaceDocuments.isFetchingNextPage}
                    onLoadMore={() => void workspaceDocuments.fetchNextPage()}
                    onRetry={() => void workspaceDocuments.refetch()}
                    onToggle={toggleAttachment}
                    onClose={closeAttachmentMenu}
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
                {pick("上传资料", "Upload material")}
              </button>
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={chatMutation.isPending || uploadOperation?.pending}
                className="quiet-button min-h-8 px-2 text-xs"
              >
                <Camera className="h-3.5 w-3.5" />
                {pick("拍照", "Take photo")}
              </button>
              <input
                ref={uploadInputRef}
                type="file"
                accept={materialFileAccept}
                disabled={chatMutation.isPending}
                className="sr-only"
                aria-label={pick("上传学习资料", "Upload learning material")}
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
                aria-label={pick(
                  "拍照上传学习资料",
                  "Take a photo of learning material",
                )}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void processUpload(file);
                  event.currentTarget.value = "";
                }}
              />
              <span
                id="learning-message-help"
                className="ml-auto text-[10px] text-slate-600 dark:text-slate-400"
              >
                {pick(
                  "Enter 发送 · Shift+Enter 换行",
                  "Enter to send · Shift+Enter for a new line",
                )}
              </span>
            </div>

            {uploadOperation && (
              <UploadStatus
                operation={uploadOperation}
                onRetry={retryUpload}
                onChooseAnother={() => uploadInputRef.current?.click()}
              />
            )}
            {attachments.length > 0 && (
              <div
                className="mt-3 flex flex-wrap gap-2"
                aria-label={pick("本轮附件", "Turn attachments")}
              >
                {attachments.map((id) => {
                  const attachmentName =
                    availableDocuments.find((document) => document.id === id)
                      ?.filename ?? pick("未命名资料", "Untitled material");
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 py-1 pl-2.5 pr-1 text-xs text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      {attachmentName}
                      <button
                        type="button"
                        onClick={() => toggleAttachment(id)}
                        aria-label={pick(
                          `移除附件 ${attachmentName}`,
                          `Remove attachment ${attachmentName}`,
                        )}
                        className="inline-flex h-6 w-6 items-center justify-center rounded focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            </div>
          )}
        </section>

        {hasProgressColumn && (
          <aside
            className="hidden space-y-4 xl:block"
            aria-label={pick("学习进展", "Learning progress")}
          >
            {latestResult && (
              <ContextPanel title={pick("本轮进展", "This turn")}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <CognitiveBadge level={latestResult.cognitive_level} />
                  <button
                    type="button"
                    className="quiet-button min-h-8 px-2 text-xs"
                    onClick={() => setLearningStatusOpen(true)}
                    aria-haspopup="dialog"
                  >
                    {pick("查看详情", "View details")}
                  </button>
                </div>
                <MasteryBar
                  value={latestResult.learner_update.mastery_score}
                  confidence={latestResult.learner_update.confidence}
                  label={pick("掌握度", "Mastery")}
                />
                <p className="mt-3 text-xs font-medium text-slate-700 dark:text-slate-200">
                  {learnerDecisionLabel(
                    latestResult.learner_update.decision,
                    locale,
                  )}
                </p>
                <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-500">
                  {latestResult.learner_update.reason}
                </p>
                {(hasMisconceptions || hasEvidence) && (
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3 text-[11px] dark:border-slate-800">
                    {hasMisconceptions && (
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                        {insights.misconceptions.current.length > 0
                          ? pick(
                              `需纠正 ${insights.misconceptions.current.length}`,
                              `${insights.misconceptions.current.length} to address`,
                            )
                          : pick(
                              `已纠正记录 ${insights.misconceptions.history.length}`,
                              `${insights.misconceptions.history.length} resolved`,
                            )}
                      </span>
                    )}
                    {hasEvidence && (
                      <span className="rounded-full bg-indigo-50 px-2 py-1 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200">
                        {pick(
                          `学习证据 ${insights.evidence.length}`,
                          `${insights.evidence.length} learning records`,
                        )}
                      </span>
                    )}
                  </div>
                )}
                {isUpdatingInsights && (
                  <p
                    className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 text-[11px] text-indigo-700 dark:border-slate-800 dark:text-indigo-200"
                    role="status"
                  >
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    {pick("正在更新学习记录…", "Updating learning records…")}
                  </p>
                )}
              </ContextPanel>
            )}
            {!latestResult && (hasMisconceptions || hasEvidence) && (
              <ContextPanel title={pick("学习记录", "Learning records")}>
                <p className="text-xs leading-5 text-slate-500">
                  {[
                    hasMisconceptions
                      ? pick(
                          `${misconceptionCount} 条误解记录`,
                          `${misconceptionCount} misconception records`,
                        )
                      : null,
                    hasEvidence
                      ? pick(
                          `${insights.evidence.length} 条学习证据`,
                          `${insights.evidence.length} learning records`,
                        )
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <button
                  type="button"
                  className="secondary-button mt-3 min-h-8 w-full px-3 py-1 text-xs"
                  onClick={() => setLearningStatusOpen(true)}
                  aria-haspopup="dialog"
                >
                  {pick("查看详情", "View details")}
                </button>
              </ContextPanel>
            )}
            {hasInsightFailure && !hasMisconceptions && !hasEvidence && (
              <ContextPanel
                title={pick(
                  "学习进展暂不可用",
                  "Learning progress unavailable",
                )}
              >
                <p className="text-xs leading-5 text-slate-500">
                  {pick(
                    "部分学习记录加载失败，不影响继续对话。",
                    "Some learning records could not be loaded. You can keep chatting.",
                  )}
                </p>
                <button
                  type="button"
                  className="secondary-button mt-3 min-h-8 w-full px-3 py-1 text-xs"
                  onClick={() => {
                    void Promise.allSettled([
                      insightPanels.prerequisites.retry(),
                      insightPanels.misconceptions.retry(),
                      insightPanels.evidence.retry(),
                    ]);
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {pick("重试加载", "Retry")}
                </button>
              </ContextPanel>
            )}
          </aside>
        )}
      </div>
      <LearningStatusSheet
        open={learningStatusOpen}
        onOpenChange={setLearningStatusOpen}
        result={learningInsightsResult}
        latestResult={latestResult}
        onStartPrerequisite={startPrerequisite}
      />
    </div>
  );
}

function UserTurn({ message }: { message: ConversationMessage }) {
  const { pick } = useI18n();
  const { currentLearner } = useAppStore();
  const contentLanguage = normalizedContentLanguage(currentLearner?.language);
  return (
    <div className="flex justify-end">
      <div className="max-w-[94%] rounded-2xl rounded-br-md bg-[#3157D5] px-4 py-3 text-sm leading-7 text-white shadow-sm sm:max-w-[88%]">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-indigo-100">
          {pick("你", "You")}
        </p>
        <p className="whitespace-pre-wrap break-words" lang={contentLanguage}>
          {message.text}
        </p>
        {message.attachmentNames && message.attachmentNames.length > 0 && (
          <p className="mt-2 border-t border-white/20 pt-2 text-[11px] text-indigo-100">
            {pick("附件：", "Attachments: ")}
            {message.attachmentNames.join(pick("、", ", "))}
          </p>
        )}
      </div>
    </div>
  );
}

export function TeachingTurn({
  result,
  knownMaterialIds,
}: {
  result: ChatResponse;
  knownMaterialIds?: ReadonlySet<UUID>;
}) {
  const { locale, pick } = useI18n();
  const { currentLearner, recentDocuments } = useAppStore();
  const contentLanguage = normalizedContentLanguage(currentLearner?.language);
  const localKnownMaterialIds = new Set(
    recentDocuments.map((document) => document.id),
  );
  const effectiveKnownMaterialIds = knownMaterialIds ?? localKnownMaterialIds;
  const hasKnownExternalSource = result.sources.some(
    (source) =>
      typeof source.document_id === "string" &&
      effectiveKnownMaterialIds.has(source.document_id),
  );
  return (
    <article
      className="min-w-0 space-y-3"
      aria-label={pick("教师教学响应", "Tutor response")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-[#3157D5] dark:bg-indigo-950">
          <Sparkles className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold">
          {pick("教师讲解", "Tutor explanation")}
        </span>
        <CognitiveBadge level={result.cognitive_level} />
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {teachingActionLabel(result.teaching_action, locale)}
        </span>
      </div>
      <section className="min-w-0 rounded-xl border border-slate-200 border-l-indigo-400 bg-slate-50 px-4 py-4 dark:border-slate-700 dark:border-l-indigo-500 dark:bg-slate-800/70">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2 dark:border-slate-700">
          <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
            {pick("目标知识点", "Learning topic")} ·{" "}
            <span lang={contentLanguage}>{result.target_knowledge_point.name}</span>
          </p>
          <span className="text-[10px] text-slate-500">
            {pick(
              "可复制回答、代码与公式",
              "Answer, code, and formulas can be copied",
            )}
          </span>
        </div>
        <TeachingResponse
          content={result.response}
          contentLanguage={contentLanguage}
        />
      </section>
      {!hasKnownExternalSource && (
        <p
          className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/25 dark:text-sky-200"
          role="status"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {pick(
            "本轮未关联你添加的外部资料，内容仅作为教学解释，尚未由可追溯来源确认。",
            "This turn is not linked to an external material you added. Treat it as a teaching explanation that has not yet been confirmed by traceable evidence.",
          )}
        </p>
      )}
      {result.model_fallback && (
        <p
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
          role="status"
        >
          {pick(
            "本轮模型响应未能通过格式校验，已使用当前来源的安全回退内容。",
            "The model response did not pass format validation, so safe fallback content from the available sources is shown.",
          )}
        </p>
      )}
      <section
        className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/20"
        aria-label={pick("掌握检测", "Mastery check")}
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-amber-600" />
          <h3 className="text-xs font-semibold text-amber-900 dark:text-amber-200">
            {pick("唯一掌握检测", "One mastery check")} ·{" "}
            {assessmentTypeLabel(result.assessment.type, locale)}
          </h3>
        </div>
        <p
          className="mt-2 text-sm leading-6 text-amber-900/80 dark:text-amber-100/80"
          lang={contentLanguage}
        >
          {result.assessment.question}
        </p>
      </section>
      {result.sources.length > 0 && (
        <details className="group rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <summary className="cursor-pointer list-none rounded-xl px-4 py-3 text-sm font-medium text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:text-slate-200 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center justify-between gap-3">
              <span>
                {hasKnownExternalSource
                  ? pick("查看参考来源", "View sources")
                  : pick("查看本轮依据（未外部确认）", "View turn basis (not externally confirmed)")}
              </span>
              <span className="text-xs font-normal text-slate-500">
                {pick(
                  `${result.sources.length} 条`,
                  `${result.sources.length} sources`,
                )}
              </span>
            </span>
          </summary>
          <section
            className="border-t border-slate-100 p-4 dark:border-slate-800"
            aria-label={pick("本轮来源", "Sources for this turn")}
          >
            <SourceList sources={result.sources} />
          </section>
        </details>
      )}
    </article>
  );
}

function AttachmentMenu({
  documents,
  selected,
  loading,
  loadError,
  hasMore,
  loadingMore,
  onLoadMore,
  onRetry,
  onToggle,
  onClose,
}: {
  documents: ReturnType<typeof documentsForWorkspace>;
  selected: UUID[];
  loading: boolean;
  loadError: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onToggle: (id: UUID) => void;
  onClose: () => void;
}) {
  const { pick } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const firstItem = menu.querySelector<HTMLButtonElement>(
      '[role="menuitemcheckbox"]',
    );
    const activeElement = document.activeElement;
    if (firstItem) {
      if (activeElement === menu || !menu.contains(activeElement)) {
        firstItem.focus();
      }
      return;
    }
    if (!menu.contains(activeElement)) menu.focus();
  }, [documents]);
  return (
    <div
      ref={menuRef}
      id="learning-attachment-menu"
      role="menu"
      tabIndex={-1}
      aria-label={pick("选择本轮资料", "Choose materials for this turn")}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return;
        }
        const items = Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>(
            '[role="menuitemcheckbox"]',
          ) ?? [],
        );
        if (items.length === 0) return;
        const currentIndex = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const requestedIndex =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : event.key === "ArrowDown"
                ? (Math.max(currentIndex, -1) + 1) % items.length
                : event.key === "ArrowUp"
                  ? (currentIndex <= 0 ? items.length : currentIndex) - 1
                  : null;
        if (requestedIndex === null) return;
        event.preventDefault();
        items[requestedIndex]?.focus();
      }}
      className="absolute bottom-10 left-0 z-20 max-h-72 w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900"
    >
      {documents.length === 0 && loading ? (
        <p className="flex items-center gap-2 px-3 py-4 text-xs text-slate-500" role="status">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {pick("正在读取已保存的资料…", "Loading saved materials…")}
        </p>
      ) : documents.length === 0 && loadError ? (
        <div className="px-3 py-4 text-xs leading-5 text-amber-700 dark:text-amber-300" role="alert">
          <p>
            {pick(
              "暂时无法读取资料列表，不能确认当前主题是否为空。",
              "The material list could not be loaded, so this topic may not be empty.",
            )}
          </p>
          <button
            type="button"
            className="secondary-button mt-2 min-h-8 px-2 py-1 text-xs"
            onClick={onRetry}
          >
            {pick("重试读取", "Retry loading")}
          </button>
        </div>
      ) : documents.length === 0 ? (
        <p className="px-3 py-4 text-xs text-slate-500">
          {pick(
            "当前学习空间还没有可用资料。",
            "There are no materials in this workspace yet.",
          )}
        </p>
      ) : (
        <>
          <p className="px-3 pb-2 text-[10px] leading-4 text-slate-600 dark:text-slate-400">
            {pick(
              "尚未处理的资料会在发送时自动准备完成。",
              "Materials that are not ready will be prepared automatically when you send.",
            )}
          </p>
          {documents.map((document) => (
            <button
              type="button"
              key={document.id}
              onClick={() => {
                onToggle(document.id);
                onClose();
              }}
              role="menuitemcheckbox"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:hover:bg-indigo-950/50"
              aria-checked={selected.includes(document.id)}
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
              <FileText className="h-3.5 w-3.5 shrink-0 text-slate-600 dark:text-slate-400" />
              <span className="min-w-0 flex-1 truncate">
                {document.filename}
              </span>
              <span className="text-[9px] text-slate-600 dark:text-slate-400">
                {document.status === "INGESTED"
                  ? pick("可使用", "Ready")
                  : pick("发送时准备", "Prepare on send")}
              </span>
            </button>
          ))}
          {loadError && (
            <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200" role="alert">
              <p>
                {pick(
                  "更早的资料加载失败，当前列表可能不完整。",
                  "Older materials could not be loaded, so this list may be incomplete.",
                )}
              </p>
              <button
                type="button"
                className="quiet-button mt-1 min-h-8 px-2 py-1 text-xs"
                onClick={onRetry}
              >
                {pick("重试", "Retry")}
              </button>
            </div>
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
              {pick("加载更多资料", "Load more materials")}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function UploadStatus({
  operation,
  onRetry,
  onChooseAnother,
}: {
  operation: UploadOperation;
  onRetry?: () => void;
  onChooseAnother?: () => void;
}) {
  const { pick } = useI18n();
  const stageLabels: Record<UploadStage, [string, string]> = {
    upload: ["上传", "Upload"],
    ingest: ["处理", "Preparation"],
    attachment: ["加入附件", "Attachment"],
  };
  const stageLabel = stageLabels[operation.stage];
  const fileIssue =
    operation.error instanceof Error &&
    operation.error.message.startsWith("material-file-")
      ? (operation.error.message.slice(
          "material-file-".length,
        ) as MaterialFileIssue)
      : null;
  const localError =
    fileIssue === "unsupported"
      ? pick(
          "暂不支持这种文件，请重新选择 PDF、Word、PPT、文本、Markdown 或常见图片。",
          "This file type is not supported. Choose a PDF, Word file, slide deck, text, Markdown, or common image.",
        )
      : fileIssue === "empty"
        ? pick(
            "这个文件是空的，请重新选择包含内容的资料。",
            "This file is empty. Choose a material that contains content.",
          )
        : fileIssue === "too-large"
          ? pick(
              "单个文件不能超过 25 MB，请重新选择较小的资料。",
              "A material cannot exceed 25 MB. Choose a smaller file.",
            )
          : operation.retryable === false
            ? pick(
                "这份资料未通过文件校验，请重新选择文件。",
                "This material did not pass file validation. Choose another file.",
              )
            : operation.error instanceof Error &&
                operation.error.message === "attachment-limit"
      ? pick(
          "每轮最多加入 20 份附件。",
          "You can add up to 20 materials to one turn.",
        )
      : operation.error instanceof Error &&
          operation.error.message === "processed-attachment-limit"
        ? pick(
            "资料已处理完成，但本轮附件已达到 20 份上限。",
            "The material is ready, but this turn already has 20 attachments.",
          )
        : pick(
            "暂时无法处理这份资料，请重试。",
            "This material could not be prepared. Please try again.",
          );
  if (operation.error) {
    return (
      <div
        className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
        role="alert"
      >
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          {pick(
            `${stageLabel[0]}失败 · ${operation.fileName}：${localError}`,
            `${stageLabel[1]} failed · ${operation.fileName}: ${localError}`,
          )}
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="quiet-button min-h-8 shrink-0 border border-red-200 bg-white px-2 text-xs dark:border-red-800 dark:bg-slate-900"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {pick("重试", "Retry")}
          </button>
        )}
        {!onRetry && operation.retryable === false && onChooseAnother && (
          <button
            type="button"
            onClick={onChooseAnother}
            className="quiet-button min-h-8 shrink-0 border border-red-200 bg-white px-2 text-xs dark:border-red-800 dark:bg-slate-900"
          >
            {pick("重新选择", "Choose another")}
          </button>
        )}
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
        ? pick(
            `正在${stageLabel[0]} ${operation.fileName}…`,
            `${stageLabel[1]} in progress · ${operation.fileName}…`,
          )
        : pick(
            `${operation.fileName} 已准备完成并加入本轮附件`,
            `${operation.fileName} is ready and attached to this turn`,
          )}
    </div>
  );
}

function SourceList({ sources }: { sources: JsonObject[] }) {
  const { pick } = useI18n();
  return (
    <ul className="space-y-2">
      {sources.map((source, index) => {
        const excerpt =
          typeof source.excerpt === "string" && source.excerpt.trim()
            ? source.excerpt
            : pick(`来源 ${index + 1}`, `Source ${index + 1}`);
        const page =
          typeof source.page_number === "number"
            ? pick(`第 ${source.page_number} 页`, `Page ${source.page_number}`)
            : null;
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
            {page && (
              <p className="mt-1 text-[10px] text-slate-600 dark:text-slate-400">
                {page}
              </p>
            )}
          </li>
        );
      })}
    </ul>
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
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      {children}
    </div>
  );
}
