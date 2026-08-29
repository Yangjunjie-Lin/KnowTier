import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Clock3,
  GitBranch,
  ListOrdered,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/services/api";
import { queryKeys } from "@/lib/queryKeys";
import { rawGraphToCytoscape } from "@/lib/graph";
import {
  calculateLearningPathStates,
  type LearningPathState,
} from "@/lib/learningPath";
import { displayPercent } from "@/lib/utils";
import { useAppStore } from "@/stores/AppContext";
import { CognitiveBadge } from "@/components/shared/LearningVisuals";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/States";
import { PageHeader } from "@/components/shared/PageHeader";
import type {
  LearnerModelItem,
  LearningPlan,
  LearningPriority,
} from "@/types/api";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { useI18n } from "@/lib/i18n";

export function LearningPathPage() {
  const { locale, pick } = useI18n();
  const { currentLearner, preferences } = useAppStore();
  const [target, setTarget] = useState("");
  const [view, setView] = useState<"linear" | "graph">("linear");
  const model = useQuery({
    queryKey: queryKeys.model(currentLearner?.id ?? ""),
    queryFn: ({ signal }) => api.getLearnerModel(currentLearner!.id, signal),
    enabled: Boolean(currentLearner),
  });
  const path = useQuery({
    queryKey: queryKeys.learningPath(
      currentLearner?.id ?? "",
      target || undefined,
    ),
    queryFn: ({ signal }) =>
      api.getLearningPath(currentLearner!.id, target || undefined, signal),
    enabled: Boolean(currentLearner),
    placeholderData: keepPreviousData,
  });
  if (!currentLearner)
    return (
      <EmptyState
        title={pick("尚未选择学习者", "No learner selected")}
        description={pick("先选择学习者，才能生成与其掌握状态匹配的学习路径。", "Select a learner to create a path matched to their progress.")}
        action={
          <Link to="/init" className="primary-button">
            {pick("选择学习者", "Select learner")}
          </Link>
        }
      />
    );
  if (path.isLoading || model.isLoading)
    return <LoadingState label={pick("正在计算前置链", "Building your learning path")} />;
  if (path.isError)
    return (
      <ErrorState error={path.error} onRetry={() => void path.refetch()} />
    );
  if (model.isError)
    return (
      <ErrorState error={model.error} onRetry={() => void model.refetch()} />
    );
  const data = path.data;
  const ids = data?.knowledge_point_ids ?? [];
  const modelMap = new Map<string, LearnerModelItem>(
    (model.data?.items ?? []).map((item) => [item.knowledge_point_id, item]),
  );
  if (ids.length === 0 && modelMap.size === 0) {
    return (
      <div>
        <PageHeader
          eyebrow={pick("下一步学什么", "What to learn next")}
          title={pick("学习路径", "Learning path")}
          description={pick("按前置关系和当前掌握程度安排学习顺序，直接从可学习的知识点开始。", "Follow prerequisites and your current mastery to start with the right topic.")}
        />
        <EmptyState
          title={pick("暂时没有可生成的路径", "No learning path is available yet")}
          description={pick("先添加学习资料建立知识点，或开始一次学习来生成掌握记录。", "Add learning materials or start a lesson to create knowledge points and progress records.")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link
                to="/materials"
                className={target ? "secondary-button" : "primary-button"}
              >
                {pick("添加学习资料", "Add material")}
              </Link>
              <Link to="/learn" className="secondary-button">
                {pick("开始学习", "Start learning")}
              </Link>
            </div>
          }
        />
      </div>
    );
  }
  const graph = (() => {
    const graphNodes = data?.nodes ?? [];
    const assertions = data?.assertions ?? [];
    if (graphNodes.length)
      return rawGraphToCytoscape(
        {
          nodes: graphNodes,
          assertions,
        },
        { revision_id: data?.graph_revision_id ?? null },
      );
    const nodes = ids.map((id) => {
      const item = modelMap.get(id);
      return {
        id,
        type: "KnowledgePoint",
        label: item?.knowledge_point ?? id,
        current_level: item?.current_level ?? 1,
        mastery_score: item?.mastery_score ?? 0,
      };
    });
    return rawGraphToCytoscape({ nodes, assertions: [] });
  })();
  const names = new Map(
    graph.elements.nodes.map((node) => [
      node.data.id,
      typeof node.data.label === "string" ? node.data.label : node.data.id,
    ]),
  );
  const pathStates = calculateLearningPathStates(ids, modelMap, new Date(), locale);
  return (
    <div>
      <PageHeader
        eyebrow={pick("下一步学什么", "What to learn next")}
        title={pick("学习路径", "Learning path")}
        description={pick("按前置关系和当前掌握程度安排学习顺序，直接从可学习的知识点开始。", "Follow prerequisites and your current mastery to start with the right topic.")}
        actions={
          <div
            className="flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
            role="group"
            aria-label={pick("学习路径显示方式", "Learning path view")}
          >
            <button
              type="button"
              onClick={() => setView("linear")}
              aria-pressed={view === "linear"}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs ${view === "linear" ? "bg-indigo-50 text-[#3157D5] dark:bg-indigo-950" : "text-slate-500"}`}
            >
              <ListOrdered className="h-3.5 w-3.5" />
              {pick("线性", "Steps")}
            </button>
            <button
              type="button"
              onClick={() => setView("graph")}
              aria-pressed={view === "graph"}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs ${view === "graph" ? "bg-indigo-50 text-[#3157D5] dark:bg-indigo-950" : "text-slate-500"}`}
            >
              <GitBranch className="h-3.5 w-3.5" />
              {pick("图谱", "Map")}
            </button>
          </div>
        }
      />
      <PlanFocusCard plan={data?.plan} />
      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <label className="flex flex-col gap-2 text-xs font-medium text-slate-600 sm:flex-row sm:items-center dark:text-slate-300">
          <span className="inline-flex items-center gap-1">
            <Target className="h-4 w-4 text-[#3157D5]" />
            {pick("我想学习", "Learning goal")}
          </span>
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="form-input sm:max-w-md"
          >
            <option value="">{pick("为我推荐下一步", "Recommend my next step")}</option>
            {(model.data?.items ?? []).map((item) => (
              <option
                key={item.knowledge_point_id}
                value={item.knowledge_point_id}
              >
                {item.knowledge_point}
              </option>
            ))}
          </select>
          {path.isFetching && (
            <span
              className="text-[11px] font-normal text-slate-500"
              role="status"
            >
              {pick("正在更新路径…", "Updating path…")}
            </span>
          )}
        </label>
      </div>
      {ids.length === 0 ? (
        <EmptyState
          title={target ? pick("没有通往该目标的可用路径", "No path to this goal is available") : pick("暂时没有可生成的路径", "No learning path is available yet")}
          description={
            target
              ? pick("当前知识关系中无法生成这条前置链。可恢复智能推荐，或先补充相关资料。", "The current knowledge relationships cannot form a path to this goal. Restore recommendations or add related material.")
              : pick("先添加学习资料建立知识点，或开始一次学习来生成掌握记录。", "Add learning materials or start a lesson to create knowledge points and progress records.")
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {target && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setTarget("")}
                >
                  {pick("恢复智能推荐", "Restore recommendations")}
                </button>
              )}
              <Link to="/materials" className="primary-button">
                {pick("添加学习资料", "Add material")}
              </Link>
              <Link to="/learn" className="secondary-button">
                {pick("开始学习", "Start learning")}
              </Link>
            </div>
          }
        />
      ) : view === "linear" ? (
        <LinearPath states={pathStates} names={names} />
      ) : (
        <GraphCanvas
          graph={graph}
          locale={locale}
          density={preferences.graphDensity}
          labelDensity={preferences.graphLabelDensity}
        />
      )}
    </div>
  );
}

function PlanFocusCard({ plan }: { plan?: LearningPlan }) {
  const { pick } = useI18n();
  const focus = plan?.focus;
  if (!plan || !focus) return null;
  return (
    <section
      className="relative mb-5 overflow-hidden rounded-3xl border border-indigo-200/80 bg-[linear-gradient(135deg,#ffffff_0%,#f4f7ff_55%,#edf2ff_100%)] p-5 shadow-[0_18px_55px_rgba(49,87,213,0.1)] dark:border-indigo-900/70 dark:bg-[linear-gradient(135deg,#0f172a_0%,#111a35_55%,#172554_100%)] sm:p-6"
      aria-labelledby="plan-focus-title"
    >
      <div
        className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-indigo-300/20 blur-3xl"
        aria-hidden="true"
      />
      <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)] xl:items-center">
        <div>
          <p className="inline-flex items-center gap-1.5 text-xs font-bold tracking-[0.16em] text-[#3157D5] uppercase dark:text-indigo-300">
            <Sparkles className="h-3.5 w-3.5" />
            {pick("今日最佳学习行动", "Best next learning action")}
          </p>
          <h2
            id="plan-focus-title"
            className="mt-3 max-w-2xl text-2xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-3xl"
          >
            {focus.knowledge_point}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-700 dark:text-slate-300">
            {priorityDescription(focus.priority, focus.unlocks_topic_count, pick)}
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/80 px-3 py-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
              <Clock3 className="h-3.5 w-3.5 text-[#3157D5]" />
              {pick(`${plan.total_minutes} 分钟`, `${plan.total_minutes} min`)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/80 px-3 py-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
              <Target className="h-3.5 w-3.5 text-[#3157D5]" />
              {pick(`目标 L${focus.target_level}`, `Target L${focus.target_level}`)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/80 px-3 py-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
              <ShieldCheck className="h-3.5 w-3.5 text-[#3157D5]" />
              {priorityLabel(focus.priority, pick)}
            </span>
          </div>
          <Link
            to="/learn"
            state={{
              learningTarget: {
                id: focus.knowledge_point_id,
                name: focus.knowledge_point,
                source: "learning-path",
                mode: focus.requested_mode,
                priority: focus.priority,
                totalMinutes: plan.total_minutes,
              },
            }}
            className="primary-button mt-5 min-h-11 px-5"
          >
            {pick(`开始 ${plan.total_minutes} 分钟学习`, `Start ${plan.total_minutes}-minute session`)}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="rounded-2xl border border-white/90 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-slate-700/80 dark:bg-slate-950/45">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <Route className="h-4 w-4 text-[#3157D5]" />
            {pick("本次学习节奏", "Session agenda")}
          </p>
          <ol className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            {plan.steps.map((step, index) => (
              <li key={step.phase} className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#3157D5] text-xs font-bold text-white shadow-sm">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {phaseLabel(step.phase, pick)}
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-600 dark:text-slate-400">
                    {strategyLabel(step.strategy, pick)} · {step.minutes} min
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

type PickCopy = (zh: string, en: string) => string;

function priorityLabel(priority: LearningPriority, pick: PickCopy): string {
  const labels: Record<LearningPriority, [string, string]> = {
    correct_misconception: ["纠正关键误解", "Correct a misconception"],
    review_due: ["到期复习", "Review due"],
    unlock_prerequisite: ["解锁前置", "Unlock a prerequisite"],
    remediate_foundation: ["巩固基础", "Strengthen foundations"],
    continue_practice: ["继续练习", "Continue practice"],
    start_topic: ["开始新主题", "Start a new topic"],
    deepen_mastery: ["深化掌握", "Deepen mastery"],
  };
  const [zh, en] = labels[priority];
  return pick(zh, en);
}

function priorityDescription(
  priority: LearningPriority,
  unlocksTopicCount: number,
  pick: PickCopy,
): string {
  if (priority === "unlock_prerequisite" && unlocksTopicCount > 0) {
    return pick(
      `先完成这个前置主题，可解锁后续 ${unlocksTopicCount} 个学习节点。`,
      `Complete this prerequisite first to unlock ${unlocksTopicCount} later topic${unlocksTopicCount === 1 ? "" : "s"}.`,
    );
  }
  const descriptions: Record<LearningPriority, [string, string]> = {
    correct_misconception: [
      "这里有仍在影响理解的误解，优先纠正能避免后续知识建立在错误基础上。",
      "An active misconception is affecting understanding; correct it before building further.",
    ],
    review_due: [
      "这个主题已到复习时间，用一次主动回忆巩固长期记忆。",
      "This topic is due. Use active recall to strengthen long-term retention.",
    ],
    unlock_prerequisite: ["先打稳这个基础，再继续后续路径。", "Build this foundation before continuing."],
    remediate_foundation: [
      "当前证据显示基础仍不稳定，先换一种表示并完成针对性练习。",
      "Current evidence shows an unstable foundation; use a new representation and targeted practice.",
    ],
    continue_practice: [
      "你已经有学习证据，下一轮练习将帮助形成稳定、独立的理解。",
      "You already have evidence; another practice round can make understanding independent and stable.",
    ],
    start_topic: [
      "这是当前路径中已满足前置条件、最适合开始的主题。",
      "This is the best unstarted topic whose prerequisites are ready.",
    ],
    deepen_mastery: [
      "继续提升认知层级，并用迁移任务检验是否真正掌握。",
      "Move to the next cognitive level and verify mastery through transfer.",
    ],
  };
  const [zh, en] = descriptions[priority];
  return pick(zh, en);
}

function phaseLabel(phase: LearningPlan["steps"][number]["phase"], pick: PickCopy) {
  if (phase === "activate") return pick("激活旧知", "Activate");
  if (phase === "build") return pick("建立理解", "Build");
  return pick("独立检测", "Check");
}

function strategyLabel(strategy: string, pick: PickCopy): string {
  const labels: Record<string, [string, string]> = {
    retrieval_warmup: ["主动回忆", "Retrieval warm-up"],
    contrast_and_correct: ["对比纠错", "Contrast and correct"],
    spaced_retrieval: ["间隔提取", "Spaced retrieval"],
    prerequisite_scaffold: ["前置脚手架", "Prerequisite scaffold"],
    worked_example: ["例题重建", "Worked example"],
    guided_practice: ["引导练习", "Guided practice"],
    conceptual_bridge: ["概念桥接", "Conceptual bridge"],
    transfer_challenge: ["迁移挑战", "Transfer challenge"],
    independent_mastery_check: ["掌握检测", "Mastery check"],
  };
  const [zh, en] = labels[strategy] ?? [strategy, strategy];
  return pick(zh, en);
}

function LinearPath({
  states,
  names,
}: {
  states: LearningPathState[];
  names: ReadonlyMap<string, string>;
}) {
  const { pick } = useI18n();
  return (
    <div
      className="relative space-y-3 pl-5 before:absolute before:bottom-5 before:left-[11px] before:top-5 before:w-px before:bg-indigo-200 dark:before:bg-indigo-900"
      aria-label={pick("推荐学习顺序", "Recommended learning order")}
    >
      {states.map((state, index) => {
        const { id, item } = state;
        const canStart = state.status !== "blocked";
        const name = item?.knowledge_point ?? names.get(id) ?? pick("未命名知识点", "Unnamed knowledge point");
        return (
          <div
            key={id}
            className="relative grid gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.55fr)_auto]"
          >
            <span
              className={`absolute -left-[21px] top-5 flex h-5 w-5 items-center justify-center rounded-full border-2 bg-white text-[10px] font-mono dark:bg-slate-950 ${statusDotClass(state.status)}`}
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">{name}</h2>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(state.status)}`}>
                  {state.statusLabel}
                </span>
                {item && (
                  <CognitiveBadge level={item.current_level} size="xs" />
                )}
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
                {item
                  ? state.reason
                  : pick("还没有该知识点的个人学习记录，可直接开始学习。", "No personal progress exists for this topic yet; you can start now.")}
              </p>
              {item && (
                <div className="mt-3 max-w-md">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>{pick("掌握度", "Mastery")}</span>
                    <span>{displayPercent(item.mastery_score)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-full rounded-full ${state.status === "mastered" ? "bg-emerald-500" : "bg-[#5577E8]"}`}
                      style={{ width: `${displayPercent(item.mastery_score)}` }}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="min-w-0 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-950">
              <p className="font-semibold text-slate-600 dark:text-slate-300">{pick("前置知识", "Prerequisites")}</p>
              {!item ? (
                <p className="mt-1 text-slate-400">{pick("暂无掌握记录", "No progress record")}</p>
              ) : item.prerequisites.length === 0 ? (
                <p className="mt-1 text-slate-500">{pick("无前置要求", "No prerequisites")}</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {item.prerequisites.map((prerequisite) => (
                    <li key={prerequisite.knowledge_point_id} className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate">{prerequisite.knowledge_point}</span>
                      <span className={prerequisite.status === "mastered" ? "text-emerald-600" : "text-amber-700 dark:text-amber-300"}>
                        {prerequisite.status === "mastered" ? pick("已掌握", "Mastered") : `${displayPercent(prerequisite.mastery_score)} · L${prerequisite.current_level}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 font-semibold text-slate-600 dark:text-slate-300">{pick("推荐动作", "Recommended action")}</p>
              <p className="mt-1 leading-5 text-slate-500">
                {item
                  ? state.recommendedAction
                  : pick("开始学习并建立第一条掌握记录", "Start learning to create your first progress record")}
              </p>
            </div>
            <div className="flex items-center gap-2 lg:flex-col lg:items-stretch lg:justify-center">
              {canStart ? (
                <Link
                  to="/learn"
                  state={{ learningTarget: { id, name, source: "learning-path" } }}
                  className="primary-button whitespace-nowrap"
                  aria-label={pick(`开始学习：${name}`, `Start learning: ${name}`)}
                >
                  {state.status === "needs_review" || state.status === "mastered" ? pick("开始复习", "Review now") : pick("开始学习", "Start learning")}
                </Link>
              ) : (
                <button type="button" className="secondary-button whitespace-nowrap" disabled title={state.reason}>
                  {pick("前置未满足", "Prerequisites incomplete")}
                </button>
              )}
              {index < states.length - 1 && (
                <ArrowRight className="mx-auto h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function statusDotClass(status: LearningPathState["status"]): string {
  if (status === "mastered") return "border-emerald-500 text-emerald-600";
  if (status === "blocked") return "border-amber-500 text-amber-700";
  if (status === "needs_review") return "border-violet-500 text-violet-700";
  return "border-[#5577E8] text-[#3157D5]";
}

function statusBadgeClass(status: LearningPathState["status"]): string {
  const classes: Record<LearningPathState["status"], string> = {
    mastered: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    in_progress: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    recommended_next: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
    blocked: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    not_started: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    needs_review: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  };
  return classes[status];
}
