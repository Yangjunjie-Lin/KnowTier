import { useQuery } from "@tanstack/react-query";
import { Download, Filter, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/services/api";
import { queryKeys } from "@/lib/queryKeys";
import {
  displayPercent,
  formatDate,
  jsonText,
} from "@/lib/utils";
import { useAppStore } from "@/stores/AppContext";
import type { GraphEdgeData, GraphNodeData, JsonObject } from "@/types/api";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import {
  CognitiveBadge,
  MasteryBar,
} from "@/components/shared/LearningVisuals";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/States";
import { PageHeader } from "@/components/shared/PageHeader";
import { RuntimeModelBadge } from "@/components/shared/RuntimeModelBadge";
import { Sheet } from "@/components/shared/Sheet";
import { domainNodeTypeLabel } from "@/lib/domainDetails";
import { learnerRelationLabel } from "@/lib/versionDetails";

const graderLabels = {
  correctness: "正确性",
  reasoning: "推理",
  independence: "独立完成",
  transfer: "迁移应用",
} as const;

export function StudentGraphPage() {
  const { currentLearner, preferences } = useAppStore();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNodeData | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdgeData | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const graph = useQuery({
    queryKey: queryKeys.learnerGraph(currentLearner?.id ?? ""),
    queryFn: ({ signal }) =>
      api.getLearnerGraph(currentLearner!.id, signal),
    enabled: Boolean(currentLearner),
  });
  const nodeDetail = useQuery({
    queryKey: ["learner-node-detail", currentLearner?.id, selectedNode?.id],
    queryFn: ({ signal }) =>
      api.getLearnerNodeDetail(
        currentLearner!.id,
        selectedNode!.id,
        signal,
      ),
    enabled: Boolean(currentLearner && selectedNode && detailOpen),
  });
  const edgeDetail = useQuery({
    queryKey: [
      "learner-edge-detail",
      currentLearner?.id,
      selectedEdge?.assertion_id ?? selectedEdge?.id,
    ],
    queryFn: ({ signal }) =>
      api.getLearnerAssertionDetail(
        currentLearner!.id,
        selectedEdge!.assertion_id ?? selectedEdge!.id,
        signal,
      ),
    enabled: Boolean(currentLearner && selectedEdge && detailOpen),
  });
  const types = useMemo(
    () =>
      Array.from(
        new Set(
          (graph.data?.elements.nodes ?? []).map((node) => node.data.type),
        ),
      ).sort(),
    [graph.data],
  );
  if (!currentLearner)
    return (
      <EmptyState
        title="尚未选择学习者"
        description="先选择学习者，才能查看对应的掌握状态图谱。"
        action={
          <Link to="/init" className="primary-button">
            选择学习者
          </Link>
        }
      />
    );
  if (graph.isLoading) return <LoadingState label="正在加载学生知识图谱" />;
  if (graph.isError)
    return (
      <ErrorState error={graph.error} onRetry={() => void graph.refetch()} />
    );
  if (!graph.data || graph.data.elements.nodes.length <= 1)
    return (
      <EmptyState
        title="学生图谱还为空"
        description="完成学习对话后，这里会展示掌握状态、证据关系与版本变化。"
        action={
          <Link to="/learn" className="primary-button">
            开始学习
          </Link>
        }
      />
    );
  const onNode = (node: GraphNodeData) => {
    setSelectedNode(node);
    setSelectedEdge(null);
    setDetailOpen(true);
  };
  const onEdge = (edge: GraphEdgeData) => {
    setSelectedEdge(edge);
    setSelectedNode(null);
    setDetailOpen(true);
  };
  const toggleType = (type: string) =>
    setTypeFilter((current) =>
      current.includes(type)
        ? current.filter((item) => item !== type)
        : [...current, type],
    );
  const exportGraph = () => {
    try {
      const blob = new Blob([JSON.stringify(graph.data, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `learner-graph-${currentLearner.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportError(null);
    } catch (error) {
      setExportError(error);
    }
  };
  return (
    <div>
      <PageHeader
        eyebrow="学习状态"
        title="学生知识图谱"
        description="查看当前学习者的掌握状态、证据和知识联系。点击任意节点可展开详情。"
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="secondary-button" onClick={exportGraph}>
              <Download className="h-4 w-4" /> 导出数据
            </button>
            <Link to="/history/learner" className="secondary-button">
              查看版本记录
            </Link>
          </div>
        }
      />
      {exportError !== null && (
        <div className="mb-4">
          <ErrorState error={exportError} onRetry={exportGraph} />
        </div>
      )}
      <div className="mb-4">
        <RuntimeModelBadge role="graph" label="图谱分析" />
      </div>
      <div className="toolbar-card mb-4 grid gap-3 md:grid-cols-[minmax(16rem,1fr)_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            aria-label="搜索学生图节点"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="form-input pl-9"
            placeholder="搜索知识点或学习状态"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <Filter className="h-4 w-4" />
          <span>类型</span>
          {types.map((type) => (
            <button
              type="button"
              key={type}
              onClick={() => toggleType(type)}
              aria-pressed={typeFilter.includes(type)}
              className={`filter-chip ${typeFilter.includes(type) ? "filter-chip-active" : ""}`}
            >
              {domainNodeTypeLabel(type)}
            </button>
          ))}
          {typeFilter.length > 0 && (
            <button
              type="button"
              className="quiet-button min-h-8 px-2"
              onClick={() => setTypeFilter([])}
            >
              清除筛选
            </button>
          )}
          <span className="ml-auto whitespace-nowrap">
            {graph.data.elements.edges.length} 条关系
          </span>
        </div>
      </div>
      <GraphCanvas
        graph={graph.data}
        selectedId={selectedNode?.id ?? selectedEdge?.id ?? null}
        search={search}
        nodeTypes={typeFilter}
        density={preferences.graphDensity}
        labelDensity={preferences.graphLabelDensity}
        onNodeSelect={onNode}
        onEdgeSelect={onEdge}
      />
      {detailOpen && (
        <StudentDetailDrawer
          title={selectedNode ? "学生节点详情" : "学生关系详情"}
          data={
            (nodeDetail.data?.data ??
              edgeDetail.data?.data ??
              selectedNode ??
              selectedEdge) as JsonObject | GraphNodeData | GraphEdgeData
          }
          loading={nodeDetail.isLoading || edgeDetail.isLoading}
          error={nodeDetail.error ?? edgeDetail.error}
          kind={selectedNode ? "node" : "edge"}
          onRetry={() => {
            if (selectedNode) void nodeDetail.refetch();
            else void edgeDetail.refetch();
          }}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </div>
  );
}

function StudentDetailDrawer({
  title,
  data,
  loading,
  error,
  kind,
  onRetry,
  onClose,
}: {
  title: string;
  data: JsonObject | GraphNodeData | GraphEdgeData;
  loading: boolean;
  error: unknown;
  kind: "node" | "edge";
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      description={`${title}侧边栏`}
    >
      {loading ? (
        <LoadingState label="正在读取学生详情" />
      ) : error ? (
        <div className="mt-4">
          <ErrorState error={error} onRetry={onRetry} />
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {kind === "node" ? (
            <NodeSummary data={data as JsonObject} />
          ) : (
            <EdgeSummary data={data as JsonObject} />
          )}
          <details className="rounded-lg border border-slate-100 dark:border-slate-800">
            <summary className="cursor-pointer px-3 py-2 text-xs text-slate-500">
              技术数据（JSON）
            </summary>
            <pre className="whitespace-pre-wrap break-words border-t border-slate-100 p-3 font-mono text-[11px] leading-5 text-slate-600 dark:border-slate-800 dark:text-slate-300">
              {jsonText(data)}
            </pre>
          </details>
        </div>
      )}
    </Sheet>
  );
}

function NodeSummary({ data }: { data: JsonObject }) {
  const level =
    typeof data.current_level === "number" ? data.current_level : null;
  const mastery =
    typeof data.mastery_score === "number" ? data.mastery_score : null;
  const confidence =
    typeof data.confidence === "number" ? data.confidence : null;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-slate-500">节点类型</p>
        <p className="mt-1 text-sm font-medium">
          {typeof data.type === "string"
            ? domainNodeTypeLabel(data.type)
            : "未知"}
        </p>
      </div>
      {level !== null && <CognitiveBadge level={level as 1 | 2 | 3 | 4 | 5 | 6} />}
      {mastery !== null && (
        <MasteryBar value={mastery} confidence={confidence ?? undefined} />
      )}
      {Array.isArray(data.assertions) && data.assertions.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            相关关系
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {data.assertions.length} 条有效关系
          </p>
        </div>
      )}
    </div>
  );
}

function EdgeSummary({ data }: { data: JsonObject }) {
  const grader =
    data.grader_scores &&
    typeof data.grader_scores === "object" &&
    !Array.isArray(data.grader_scores)
      ? (data.grader_scores as JsonObject)
      : null;
  const misconceptions = Array.isArray(data.misconceptions)
    ? data.misconceptions.filter((item): item is string => typeof item === "string")
    : [];
  const knowledgeState =
    data.knowledge_state &&
    typeof data.knowledge_state === "object" &&
    !Array.isArray(data.knowledge_state)
      ? (data.knowledge_state as JsonObject)
      : null;
  const sourceTurn =
    data.source_turn &&
    typeof data.source_turn === "object" &&
    !Array.isArray(data.source_turn)
      ? (data.source_turn as JsonObject)
      : null;
  const validFrom =
    typeof data.valid_from === "string" ? data.valid_from : null;
  const validTo = typeof data.valid_to === "string" ? data.valid_to : null;
  const supersededBy =
    typeof data.superseded_by_assertion_id === "string"
      ? data.superseded_by_assertion_id
      : typeof data.superseded_by === "string"
        ? data.superseded_by
        : null;
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-xs text-slate-500">关系类型</p>
        <p className="mt-1 font-medium">
          {typeof data.relation_type === "string"
            ? learnerRelationLabel(data.relation_type)
            : typeof data.predicate === "string"
              ? learnerRelationLabel(data.predicate)
              : "—"}
        </p>
        <p className="mt-1 font-mono text-[10px] text-slate-400">
          {typeof data.assertion_id === "string"
            ? data.assertion_id
            : typeof data.id === "string"
              ? data.id
              : ""}
        </p>
      </div>
      {knowledgeState && (
        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500">掌握状态</p>
          {typeof knowledgeState.current_level === "number" && (
            <div className="mt-2">
              <CognitiveBadge
                level={knowledgeState.current_level as 1 | 2 | 3 | 4 | 5 | 6}
                size="xs"
              />
            </div>
          )}
          {typeof knowledgeState.mastery_score === "number" && (
            <div className="mt-2">
              <MasteryBar
                value={knowledgeState.mastery_score}
                confidence={
                  typeof knowledgeState.confidence === "number"
                    ? knowledgeState.confidence
                    : undefined
                }
              />
            </div>
          )}
        </div>
      )}
      {sourceTurn && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            来源回答
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
            {typeof sourceTurn.content === "string"
              ? sourceTurn.content
              : typeof sourceTurn.id === "string"
                ? `学习轮次 ${sourceTurn.id}`
                : "暂无回答正文"}
          </p>
        </div>
      )}
      {grader && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            评分维度
          </h3>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
            {(["correctness", "reasoning", "independence", "transfer"] as const).map(
              (key) =>
                typeof grader[key] === "number" ? (
                  <div
                    key={key}
                    className="rounded bg-slate-50 px-2 py-1.5 dark:bg-slate-900"
                  >
                    <dt className="text-slate-500">{graderLabels[key]}</dt>
                    <dd className="font-mono">{displayPercent(grader[key])}</dd>
                  </div>
                ) : null,
            )}
          </dl>
        </div>
      )}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          误解
        </h3>
        {misconceptions.length ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-700 dark:text-red-300">
            {misconceptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-slate-400">暂无误解记录。</p>
        )}
      </div>
      <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
        <span>有效期起：{validFrom ? formatDate(validFrom, true) : "—"}</span>
        <span>有效期止：{validTo ? formatDate(validTo, true) : "仍有效"}</span>
        <span>
          替代历史：
          {supersededBy ? (
            <span className="font-mono text-amber-700 dark:text-amber-300">
              {supersededBy.slice(0, 8)}
            </span>
          ) : (
            "无"
          )}
        </span>
        <span>
          状态：
          {data.is_active === false || validTo
            ? "已替代/失效"
            : "活跃"}
        </span>
      </div>
    </div>
  );
}
