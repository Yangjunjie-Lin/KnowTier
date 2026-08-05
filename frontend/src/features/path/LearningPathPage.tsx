import { useQuery } from "@tanstack/react-query";
import { ArrowRight, GitBranch, ListOrdered, Target } from "lucide-react";
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
import type { LearnerModelItem } from "@/types/api";
import { GraphCanvas } from "@/components/graph/GraphCanvas";

export function LearningPathPage() {
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
  });
  if (!currentLearner) return <EmptyState title="尚未选择学习者" />;
  if (path.isLoading || model.isLoading)
    return <LoadingState label="正在计算前置链" />;
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
  const pathStates = calculateLearningPathStates(ids, modelMap);
  return (
    <div>
      <PageHeader
        eyebrow="Learning path"
        title="学习路径"
        description="使用后端返回的目标知识点与前置链，支持线性和图谱视图。"
        actions={
          <div className="flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setView("linear")}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs ${view === "linear" ? "bg-indigo-50 text-[#3157D5] dark:bg-indigo-950" : "text-slate-500"}`}
            >
              <ListOrdered className="h-3.5 w-3.5" />
              线性
            </button>
            <button
              type="button"
              onClick={() => setView("graph")}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs ${view === "graph" ? "bg-indigo-50 text-[#3157D5] dark:bg-indigo-950" : "text-slate-500"}`}
            >
              <GitBranch className="h-3.5 w-3.5" />
              图谱
            </button>
          </div>
        }
      />
      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <label className="flex flex-col gap-2 text-xs font-medium text-slate-600 sm:flex-row sm:items-center dark:text-slate-300">
          <span className="inline-flex items-center gap-1">
            <Target className="h-4 w-4 text-[#3157D5]" />
            目标知识点（可选）
          </span>
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="form-input sm:max-w-md"
          >
            <option value="">后端自动选择未掌握目标</option>
            {(model.data?.items ?? []).map((item) => (
              <option
                key={item.knowledge_point_id}
                value={item.knowledge_point_id}
              >
                {item.knowledge_point}
              </option>
            ))}
          </select>
        </label>
      </div>
      {ids.length === 0 ? (
        <EmptyState
          title="暂时没有可生成的路径"
          description="请先摄取资料或在学习空间建立知识点。"
        />
      ) : view === "linear" ? (
        <LinearPath states={pathStates} names={names} />
      ) : (
        <GraphCanvas
          graph={graph}
          density={preferences.graphDensity}
          labelDensity={preferences.graphLabelDensity}
        />
      )}
    </div>
  );
}

function LinearPath({
  states,
  names,
}: {
  states: LearningPathState[];
  names: ReadonlyMap<string, string>;
}) {
  return (
    <div className="relative space-y-3 pl-5 before:absolute before:bottom-5 before:left-[11px] before:top-5 before:w-px before:bg-indigo-200 dark:before:bg-indigo-900">
      {states.map((state, index) => {
        const { id, item } = state;
        const canStart = state.status !== "blocked";
        const name = item?.knowledge_point ?? names.get(id) ?? id;
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
              <p className="mt-1 font-mono text-[10px] text-slate-400">{id}</p>
              <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
                {state.reason}
              </p>
              {item && (
                <div className="mt-3 max-w-md">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>掌握度</span>
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
              <p className="font-semibold text-slate-600 dark:text-slate-300">前置知识</p>
              {!item ? (
                <p className="mt-1 text-slate-400">后端未提供</p>
              ) : item.prerequisites.length === 0 ? (
                <p className="mt-1 text-slate-500">无前置要求</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {item.prerequisites.map((prerequisite) => (
                    <li key={prerequisite.knowledge_point_id} className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate">{prerequisite.knowledge_point}</span>
                      <span className={prerequisite.status === "mastered" ? "text-emerald-600" : "text-amber-700 dark:text-amber-300"}>
                        {prerequisite.status === "mastered" ? "已掌握" : `${displayPercent(prerequisite.mastery_score)} · L${prerequisite.current_level}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 font-semibold text-slate-600 dark:text-slate-300">推荐动作</p>
              <p className="mt-1 leading-5 text-slate-500">{state.recommendedAction}</p>
            </div>
            <div className="flex items-center gap-2 lg:flex-col lg:items-stretch lg:justify-center">
              {canStart ? (
                <Link
                  to="/learn"
                  state={{ learningTarget: { id, name, source: "learning-path" } }}
                  className="primary-button whitespace-nowrap"
                  aria-label={`开始学习${name}`}
                >
                  {state.status === "needs_review" || state.status === "mastered" ? "开始复习" : "开始学习"}
                </Link>
              ) : (
                <button type="button" className="secondary-button whitespace-nowrap" disabled title={state.reason}>
                  前置未满足
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
