import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  BookOpenCheck,
  Download,
  Filter,
  Network,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import {
  CognitiveBadge,
  MasteryBar,
} from "@/components/shared/LearningVisuals";
import { PageHeader } from "@/components/shared/PageHeader";
import { RuntimeModelBadge } from "@/components/shared/RuntimeModelBadge";
import { Sheet } from "@/components/shared/Sheet";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/States";
import { graphNodeLabel } from "@/lib/graph";
import { useI18n } from "@/lib/i18n";
import {
  buildLearnerGraphPresentation,
  learnerGraphNodeTypeLabel,
  learnerGraphRelationLabel,
  learnerGraphRelationTypes,
  summarizeLearnerGraph,
} from "@/lib/learnerGraphPresentation";
import { queryKeys } from "@/lib/queryKeys";
import { displayPercent, formatDate, jsonText } from "@/lib/utils";
import { api } from "@/services/api";
import { useAppStore } from "@/stores/AppContext";
import type {
  CytoscapeGraph,
  GraphEdgeData,
  GraphNodeData,
  JsonObject,
} from "@/types/api";
import type { UiLocale } from "@/types/app";

const emptyGraph: CytoscapeGraph = {
  elements: { nodes: [], edges: [] },
  meta: {},
};

const graderLabels = {
  correctness: "正确性",
  reasoning: "推理",
  independence: "独立完成",
  transfer: "迁移应用",
} as const;

export function StudentGraphPage() {
  const { currentLearner, preferences } = useAppStore();
  const { locale, pick } = useI18n();
  const [search, setSearch] = useState("");
  const [relationFilter, setRelationFilter] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNodeData | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdgeData | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const graph = useQuery({
    queryKey: queryKeys.learnerGraph(currentLearner?.id ?? ""),
    queryFn: ({ signal }) => api.getLearnerGraph(currentLearner!.id, signal),
    enabled: Boolean(currentLearner),
  });
  const presentationGraph = useMemo(
    () =>
      buildLearnerGraphPresentation(
        graph.data ?? emptyGraph,
        showHistory,
        locale,
      ),
    [graph.data, locale, showHistory],
  );
  const summary = useMemo(
    () => summarizeLearnerGraph(presentationGraph),
    [presentationGraph],
  );
  const relationTypes = useMemo(
    () => learnerGraphRelationTypes(presentationGraph, locale),
    [locale, presentationGraph],
  );
  const nodeDetail = useQuery({
    queryKey: ["learner-node-detail", currentLearner?.id, selectedNode?.id],
    queryFn: ({ signal }) =>
      api.getLearnerNodeDetail(currentLearner!.id, selectedNode!.id, signal),
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

  if (!currentLearner)
    return (
      <EmptyState
        title={pick("尚未选择学习者", "No learner selected")}
        description={pick(
          "先选择学习者，才能查看对应的掌握状态和知识联系。",
          "Choose a learner to view their mastery and knowledge links.",
        )}
        action={
          <Link to="/init" className="primary-button">
            {pick("选择学习者", "Choose learner")}
          </Link>
        }
      />
    );
  if (graph.isLoading)
    return (
      <LoadingState
        label={pick("正在整理学习关系", "Organising learning links")}
      />
    );
  if (graph.isError)
    return <ErrorState error={graph.error} onRetry={() => void graph.refetch()} />;
  if (!graph.data || summary.knowledgePointCount === 0)
    return (
      <EmptyState
        title={pick("还没有可展示的学习关系", "No learning links yet")}
        description={pick(
          "完成一次学习对话后，这里会用知识点之间的联系呈现掌握进展。",
          "Complete a learning conversation to see mastery progress as connected knowledge points.",
        )}
        action={
          <Link to="/learn" className="primary-button">
            {pick("开始学习", "Start learning")}
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
  const toggleRelation = (type: string) =>
    setRelationFilter((current) =>
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
  const selectedData = selectedNode
    ? ({
        ...selectedNode,
        ...(nodeDetail.data?.data ?? {}),
      } as JsonObject)
    : ({
        ...selectedEdge,
        ...(edgeDetail.data?.data ?? {}),
      } as JsonObject);
  const selectedTitle = selectedNode
    ? graphNodeLabel(selectedNode)
    : learnerGraphRelationLabel(
        selectedEdge?.relation_type ?? selectedEdge?.predicate ?? "",
        locale,
      );

  return (
    <div>
      <PageHeader
        eyebrow={pick("学习进展", "Learning progress")}
        title={pick("学生知识图谱", "Learner knowledge graph")}
        description={pick(
          "把知识点、掌握程度和学习证据连成一张容易理解的关系图。",
          "See knowledge points, mastery and evidence as a clear network of learning links.",
        )}
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="secondary-button" onClick={exportGraph}>
              <Download className="h-4 w-4" />
              {pick("导出学习关系", "Export learning links")}
            </button>
            <Link to="/history/learner" className="secondary-button">
              {pick("查看变化记录", "View change history")}
            </Link>
          </div>
        }
      />
      {exportError !== null && (
        <div className="mb-4">
          <ErrorState error={exportError} onRetry={exportGraph} />
        </div>
      )}

      <section
        className="mb-4 grid grid-cols-3 gap-2 sm:gap-3"
        aria-label={pick("学习图谱概览", "Learning graph overview")}
      >
        <SummaryCard
          icon={<Network className="h-4 w-4" />}
          label={pick("正在学习", "In this graph")}
          value={pick(
            `${summary.knowledgePointCount} 个知识点`,
            `${summary.knowledgePointCount} knowledge points`,
          )}
        />
        <SummaryCard
          icon={<BookOpenCheck className="h-4 w-4" />}
          label={pick("平均掌握", "Average mastery")}
          value={
            summary.averageMastery === null
              ? pick("等待评估", "Not assessed")
              : displayPercent(summary.averageMastery)
          }
          hint={
            summary.evaluatedCount < summary.knowledgePointCount
              ? pick(
                  `已评估 ${summary.evaluatedCount} 个`,
                  `${summary.evaluatedCount} assessed`,
                )
              : undefined
          }
        />
        <SummaryCard
          icon={<AlertCircle className="h-4 w-4" />}
          label={pick("需要关注", "Needs attention")}
          value={
            summary.attentionCount
              ? pick(
                  `${summary.attentionCount} 个知识点`,
                  `${summary.attentionCount} knowledge points`,
                )
              : pick("暂无", "None")
          }
          tone={summary.attentionCount ? "attention" : "calm"}
        />
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <RuntimeModelBadge
          role="graph"
          label={pick("关系整理", "Relationship mapping")}
        />
        <label className="ml-auto inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-xs text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-900">
          <input
            type="checkbox"
            checked={showHistory}
            onChange={(event) => setShowHistory(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-[#3157D5] focus:ring-[#3157D5]"
          />
          {pick("显示已被替代的历史关系", "Show replaced historical links")}
        </label>
      </div>

      <div className="toolbar-card mb-4 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            aria-label={pick("搜索知识点", "Search knowledge points")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="form-input pl-9"
            placeholder={pick("搜索知识点名称", "Search by knowledge point")}
          />
        </div>
        {relationTypes.length > 0 && (
          <div className="-mx-1 flex flex-nowrap items-center gap-2 overflow-x-auto px-1 pb-1 text-xs text-slate-500 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            <Filter className="h-4 w-4 shrink-0" />
            <span className="shrink-0 font-medium">
              {pick("按关系查看", "Filter by link")}
            </span>
            {relationTypes.map((type) => (
              <button
                type="button"
                key={type}
                onClick={() => toggleRelation(type)}
                aria-pressed={relationFilter.includes(type)}
                className={`filter-chip shrink-0 ${
                  relationFilter.includes(type) ? "filter-chip-active" : ""
                }`}
              >
                {learnerGraphRelationLabel(type, locale)}
              </button>
            ))}
            {relationFilter.length > 0 && (
              <button
                type="button"
                className="quiet-button min-h-8 px-2"
                onClick={() => setRelationFilter([])}
              >
                {pick("清除筛选", "Clear filters")}
              </button>
            )}
          </div>
        )}
      </div>

      <GraphCanvas
        graph={presentationGraph}
        presentation="learner"
        locale={locale}
        selectedId={selectedNode?.id ?? selectedEdge?.id ?? null}
        search={search}
        relationTypes={relationFilter}
        density={preferences.graphDensity}
        labelDensity={preferences.graphLabelDensity}
        onNodeSelect={onNode}
        onEdgeSelect={onEdge}
      />

      {detailOpen && (
        <StudentDetailDrawer
          title={selectedTitle}
          data={selectedData}
          loading={nodeDetail.isLoading || edgeDetail.isLoading}
          error={nodeDetail.error ?? edgeDetail.error}
          kind={selectedNode ? "node" : "edge"}
          locale={locale}
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

function SummaryCard({
  icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "attention" | "calm";
}) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 dark:border-slate-800 dark:bg-slate-950">
      <div
        className={`mb-3 flex h-8 w-8 items-center justify-center rounded-lg ${
          tone === "attention"
            ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
            : tone === "calm"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-indigo-50 text-[#3157D5] dark:bg-indigo-950 dark:text-indigo-300"
        }`}
      >
        {icon}
      </div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-5 tracking-tight text-slate-900 sm:text-lg dark:text-slate-100">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function StudentDetailDrawer({
  title,
  data,
  loading,
  error,
  kind,
  locale,
  onRetry,
  onClose,
}: {
  title: string;
  data: JsonObject;
  loading: boolean;
  error: unknown;
  kind: "node" | "edge";
  locale: UiLocale;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { pick } = useI18n();
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      description={
        kind === "node"
          ? pick(
              "查看掌握进展与相关学习记录",
              "Review mastery progress and related learning records",
            )
          : pick(
              "查看这条学习关系的依据",
              "Review the evidence behind this learning link",
            )
      }
    >
      {loading ? (
        <LoadingState
          label={pick("正在读取学习详情", "Loading learning details")}
        />
      ) : error ? (
        <div className="mt-4">
          <ErrorState error={error} onRetry={onRetry} />
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {kind === "node" ? (
            <NodeSummary data={data} locale={locale} />
          ) : (
            <EdgeSummary data={data} locale={locale} />
          )}
          <details className="rounded-lg border border-slate-200 dark:border-slate-800">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-500 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#3157D5]">
              {pick("技术详情（高级）", "Technical details (advanced)")}
            </summary>
            <p className="border-t border-slate-100 px-3 pt-3 text-xs text-slate-500 dark:border-slate-800">
              {pick(
                "以下内容用于故障排查，包含内部标识和原始记录。",
                "This troubleshooting data contains internal identifiers and raw records.",
              )}
            </p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5 text-slate-600 dark:text-slate-300">
              {jsonText(data)}
            </pre>
          </details>
        </div>
      )}
    </Sheet>
  );
}

function NodeSummary({
  data,
  locale,
}: {
  data: JsonObject;
  locale: UiLocale;
}) {
  const { pick } = useI18n();
  const level = typeof data.current_level === "number" ? data.current_level : null;
  const mastery = typeof data.mastery_score === "number" ? data.mastery_score : null;
  const confidence = typeof data.confidence === "number" ? data.confidence : null;
  const type = typeof data.type === "string" ? data.type : "";
  const assertions = jsonObjectArray(data.assertions);
  const evidence = jsonObject(data.evidence);
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
        <div>
          <p className="text-xs text-slate-500">
            {pick("内容类型", "Content type")}
          </p>
          <p className="mt-1 text-sm font-semibold">
            {learnerGraphNodeTypeLabel(type, locale)}
          </p>
        </div>
        {typeof data.learner_status === "string" && (
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm dark:bg-slate-950 dark:text-slate-300">
            {data.learner_status}
          </span>
        )}
      </div>
      {level !== null && (
        <CognitiveBadge level={level as 1 | 2 | 3 | 4 | 5 | 6} />
      )}
      {mastery !== null ? (
        <MasteryBar value={mastery} confidence={confidence ?? undefined} />
      ) : (
        type === "LearnerKnowledgeState" && (
          <p className="rounded-lg border border-dashed border-slate-300 p-3 text-xs leading-5 text-slate-500 dark:border-slate-700">
            {pick(
              "完成一次相关练习后，这里会显示掌握程度。",
              "Complete a related exercise to see mastery here.",
            )}
          </p>
        )
      )}
      {evidence && <EvidenceSummary evidence={evidence} />}
      {assertions.length > 0 && (
        <section aria-labelledby="node-relations-heading">
          <h3 id="node-relations-heading" className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            {pick("相关学习关系", "Related learning links")}
          </h3>
          <ul className="mt-2 space-y-2">
            {assertions.slice(0, 6).map((assertion, index) => {
              const relation = relationValue(assertion);
              return (
                <li key={`${relation}-${index}`} className="rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
                  <p className="text-xs font-medium text-[#3157D5]">
                    {learnerGraphRelationLabel(relation, locale)}
                  </p>
                  {typeof assertion.natural_language_description === "string" &&
                    relation === "HAS_MISCONCEPTION" && (
                      <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                        {assertion.natural_language_description}
                      </p>
                    )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function EdgeSummary({
  data,
  locale,
}: {
  data: JsonObject;
  locale: UiLocale;
}) {
  const { pick } = useI18n();
  const relation = relationValue(data);
  const grader = jsonObject(data.grader_scores);
  const knowledgeState = jsonObject(data.knowledge_state);
  const knowledgePoint = jsonObject(data.knowledge_point);
  const sourceTurn = jsonObject(data.source_turn);
  const evidence = jsonObject(data.evidence);
  const sources = jsonObjectArray(data.sources);
  const misconceptions = Array.isArray(data.misconceptions)
    ? data.misconceptions.filter(
        (item): item is string => typeof item === "string" && Boolean(item.trim()),
      )
    : [];
  const validFrom = typeof data.valid_from === "string" ? data.valid_from : null;
  const validTo = typeof data.valid_to === "string" ? data.valid_to : null;
  const description =
    typeof data.display_description === "string" ? data.display_description : null;
  return (
    <div className="space-y-5 text-sm">
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 dark:border-indigo-900 dark:bg-indigo-950/40">
        <p className="text-xs font-medium text-[#3157D5] dark:text-indigo-300">
          {learnerGraphRelationLabel(relation, locale)}
        </p>
        {description && (
          <p className="mt-2 leading-6 text-slate-700 dark:text-slate-200">
            {description}
          </p>
        )}
        {typeof knowledgePoint?.name === "string" && (
          <p className="mt-2 text-xs text-slate-500">
            {pick("知识点", "Knowledge point")}: {knowledgePoint.name}
          </p>
        )}
      </div>

      {knowledgeState && (
        <div>
          <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            {pick("当前掌握", "Current mastery")}
          </h3>
          {typeof knowledgeState.current_level === "number" && (
            <div className="mt-2">
              <CognitiveBadge
                level={knowledgeState.current_level as 1 | 2 | 3 | 4 | 5 | 6}
                size="xs"
              />
            </div>
          )}
          {typeof knowledgeState.mastery_score === "number" && (
            <div className="mt-3">
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

      {evidence && <EvidenceSummary evidence={evidence} />}

      {grader && (
        <section aria-labelledby="grader-heading">
          <h3 id="grader-heading" className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            {pick("回答表现", "Response performance")}
          </h3>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
            {(["correctness", "reasoning", "independence", "transfer"] as const).map(
              (key) =>
                typeof grader[key] === "number" ? (
                  <div key={key} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900">
                    <dt className="text-slate-500">
                      {locale === "en"
                        ? {
                            correctness: "Correctness",
                            reasoning: "Reasoning",
                            independence: "Independence",
                            transfer: "Transfer",
                          }[key]
                        : graderLabels[key]}
                    </dt>
                    <dd className="mt-1 font-semibold">{displayPercent(grader[key])}</dd>
                  </div>
                ) : null,
            )}
          </dl>
        </section>
      )}

      {misconceptions.length > 0 && (
        <section aria-labelledby="misconceptions-heading">
          <h3 id="misconceptions-heading" className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            {pick("建议纠正", "Suggested corrections")}
          </h3>
          <ul className="mt-2 space-y-2">
            {misconceptions.map((item) => (
              <li key={item} className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                {item}
              </li>
            ))}
          </ul>
        </section>
      )}

      {sourceTurn && typeof sourceTurn.content === "string" && (
        <section aria-labelledby="answer-evidence-heading">
          <h3 id="answer-evidence-heading" className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            {pick("形成依据", "Supporting response")}
          </h3>
          <p className="mt-2 max-h-28 overflow-auto rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            {sourceTurn.content}
          </p>
        </section>
      )}

      {sources.length > 0 && (
        <section aria-labelledby="source-references-heading">
          <h3 id="source-references-heading" className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            {pick("参考资料", "References")}
          </h3>
          <ul className="mt-2 space-y-2">
            {sources.slice(0, 3).map((source, index) => (
              <li key={index} className="rounded-lg border border-slate-100 p-3 text-xs leading-5 text-slate-600 dark:border-slate-800 dark:text-slate-300">
                {typeof source.page_number === "number" && (
                  <span className="mb-1 block font-medium text-slate-500">
                    {pick(
                      `第 ${source.page_number} 页`,
                      `Page ${source.page_number}`,
                    )}
                  </span>
                )}
                {typeof source.text === "string"
                  ? source.text
                  : pick("已保存的参考片段", "Saved reference excerpt")}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800">
        <span>
          {validTo || data.is_active === false
            ? pick("历史记录", "Historical record")
            : pick("当前有效", "Currently active")}
        </span>
        {validFrom && (
          <span>
            {pick("记录于", "Recorded")} {formatDate(validFrom, true, locale)}
          </span>
        )}
      </div>
    </div>
  );
}

function EvidenceSummary({ evidence }: { evidence: JsonObject }) {
  const { pick } = useI18n();
  const explanation =
    typeof evidence.grader_explanation === "string"
      ? evidence.grader_explanation
      : typeof evidence.explanation === "string"
        ? evidence.explanation
        : null;
  const confidence =
    typeof evidence.grader_confidence === "number"
      ? evidence.grader_confidence
      : typeof evidence.confidence === "number"
        ? evidence.confidence
        : null;
  return (
    <section aria-labelledby="evidence-summary-heading">
      <div className="flex items-center justify-between gap-3">
        <h3 id="evidence-summary-heading" className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          {pick("掌握证据", "Mastery evidence")}
        </h3>
        {confidence !== null && (
          <span className="text-xs text-slate-500">
            {pick("可信度", "Confidence")} {displayPercent(confidence)}
          </span>
        )}
      </div>
      <p className="mt-2 rounded-lg bg-emerald-50 p-3 text-xs leading-5 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
        {explanation ??
          pick(
            "这条证据来自已保存的学习回答和评分。",
            "This evidence comes from a saved learning response and assessment.",
          )}
      </p>
    </section>
  );
}

function jsonObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function jsonObjectArray(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value
        .map(jsonObject)
        .filter((item): item is JsonObject => item !== null)
    : [];
}

function relationValue(data: JsonObject): string {
  return typeof data.relation_type === "string"
    ? data.relation_type
    : typeof data.predicate === "string"
      ? data.predicate
      : "";
}
