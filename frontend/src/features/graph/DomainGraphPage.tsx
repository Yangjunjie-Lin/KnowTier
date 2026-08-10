import { useQuery } from "@tanstack/react-query";
import {
  Download,
  Filter,
  Focus,
  LoaderCircle,
  Search,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/services/api";
import { queryKeys } from "@/lib/queryKeys";
import { rawGraphToCytoscape } from "@/lib/graph";
import { isUuid } from "@/lib/utils";
import { useAppStore } from "@/stores/AppContext";
import type {
  CytoscapeGraph,
  GraphEdgeData,
  GraphNodeData,
  JsonObject,
  JsonValue,
} from "@/types/api";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import {
  DomainAssertionDetail,
  DomainNodeDetail,
} from "@/components/graph/DomainDetails";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/States";
import { PageHeader } from "@/components/shared/PageHeader";
import { RuntimeModelBadge } from "@/components/shared/RuntimeModelBadge";
import { Sheet } from "@/components/shared/Sheet";
import {
  domainNodeTypeLabel,
  relationTypeLabel,
} from "@/lib/domainDetails";
import { useI18n } from "@/lib/i18n";

const productDomainNodeTypes = new Set([
  "Domain",
  "Theory",
  "KnowledgePoint",
  "Definition",
  "Method",
  "Example",
  "Counterexample",
  "Misconception",
]);

export function domainGraphForProduct(
  graph: CytoscapeGraph,
  includeTechnicalNodes = false,
): CytoscapeGraph {
  if (includeTechnicalNodes) return graph;
  const nodes = graph.elements.nodes.filter((node) =>
    productDomainNodeTypes.has(node.data.type),
  );
  const nodeIds = new Set(nodes.map((node) => node.data.id));
  const edges = graph.elements.edges.filter(
    (edge) =>
      nodeIds.has(edge.data.source) && nodeIds.has(edge.data.target),
  );
  return {
    ...graph,
    elements: { nodes, edges },
  };
}

export function DomainGraphPage() {
  const { locale, pick } = useI18n();
  const { currentWorkspace, preferences } = useAppStore();
  const workspaceId = currentWorkspace?.id;
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [relationFilter, setRelationFilter] = useState<string[]>([]);
  const [showTechnicalNodes, setShowTechnicalNodes] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNodeData | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdgeData | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(() => {
    const linkedNodeId = searchParams.get("node");
    return linkedNodeId && isUuid(linkedNodeId) ? linkedNodeId : null;
  });
  useEffect(() => {
    const linkedNodeId = searchParams.get("node");
    setFocusNodeId(linkedNodeId && isUuid(linkedNodeId) ? linkedNodeId : null);
  }, [searchParams]);
  const graph = useQuery({
    queryKey: queryKeys.domainGraph(workspaceId ?? ""),
    queryFn: ({ signal }) => api.getDomainGraph(workspaceId!, signal),
    enabled: Boolean(workspaceId),
  });
  const manifest = useQuery({
    queryKey: queryKeys.manifest(workspaceId ?? ""),
    queryFn: ({ signal }) => api.getManifest(workspaceId!, signal),
    enabled: Boolean(workspaceId),
  });
  const subgraph = useQuery({
    queryKey: queryKeys.domainSubgraph(workspaceId ?? "", focusNodeId ?? ""),
    queryFn: ({ signal }) =>
      api.getDomainSubgraph(workspaceId!, focusNodeId!, 2, 50, signal),
    enabled: Boolean(workspaceId && focusNodeId),
  });
  const nodeDetail = useQuery({
    queryKey: ["domain-node-detail", workspaceId, selectedNode?.id],
    queryFn: ({ signal }) =>
      api.getDomainDetail(workspaceId!, selectedNode!.id, signal),
    enabled: Boolean(workspaceId && selectedNode && detailOpen),
  });
  const edgeDetail = useQuery({
    queryKey: ["domain-edge-detail", workspaceId, selectedEdge?.assertion_id ?? selectedEdge?.id],
    queryFn: ({ signal }) =>
      api.getAssertionDetail(
        workspaceId!,
        selectedEdge!.assertion_id ?? selectedEdge!.id,
        signal,
      ),
    enabled: Boolean(workspaceId && selectedEdge && detailOpen),
  });
  const focusedGraph = useMemo(() => {
    const payload = subgraph.data?.data;
    if (!payload) return null;
    const revisionId = subgraph.data?.graph_revision_id ?? null;
    return rawGraphToCytoscape(
      {
        nodes: jsonObjectArray(payload.nodes),
        assertions: jsonObjectArray(payload.assertions),
        revision_id: revisionId,
      },
      { focus_node_id: focusNodeId },
    );
  }, [focusNodeId, subgraph.data]);
  const displayedGraph = focusedGraph ?? graph.data;
  const productGraph = useMemo(
    () =>
      displayedGraph
        ? domainGraphForProduct(displayedGraph, showTechnicalNodes)
        : null,
    [displayedGraph, showTechnicalNodes],
  );
  const types = useMemo(
    () =>
      Array.from(
        new Set(
          (productGraph?.elements.nodes ?? []).map((node) => node.data.type),
        ),
      ).sort(),
    [productGraph],
  );
  const relations = useMemo(
    () =>
      Array.from(
        new Set(
          (productGraph?.elements.edges ?? []).map(
            (edge) => edge.data.relation_type ?? edge.data.predicate ?? "",
          ),
        ),
      )
        .filter(Boolean)
        .sort(),
    [productGraph],
  );
  if (!workspaceId)
    return (
      <EmptyState
        title={pick("尚未选择学习空间", "No workspace selected")}
        description={pick("先选择学习空间，才能查看对应的领域知识图谱。", "Select a workspace to view its domain knowledge map.")}
        action={
          <Link to="/init" className="primary-button">
            {pick("选择学习空间", "Select workspace")}
          </Link>
        }
      />
    );
  if (graph.isLoading) return <LoadingState label={pick("正在加载领域知识图谱", "Loading domain knowledge map")} />;
  if (graph.isError)
    return (
      <ErrorState error={graph.error} onRetry={() => void graph.refetch()} />
    );
  const data = graph.data;
  if (!data || data.elements.nodes.length === 0)
    return (
      <EmptyState
        title={pick("领域图谱为空", "The domain map is empty")}
        description={pick("添加并处理一份学习资料后，知识点和关系会显示在这里。", "Add and process a learning material to create knowledge points and relationships.")}
        action={
          <Link to="/materials" className="primary-button">
            {pick("添加学习资料", "Add material")}
          </Link>
        }
      />
    );
  const toggle = (
    value: string,
    current: string[],
    setter: (next: string[]) => void,
  ) =>
    setter(
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  const handleNode = (node: GraphNodeData) => {
    setSelectedNode(node);
    setSelectedEdge(null);
    setDetailOpen(true);
  };
  const handleEdge = (edge: GraphEdgeData) => {
    setSelectedEdge(edge);
    setSelectedNode(null);
    setDetailOpen(true);
  };
  const exportGraph = async (format: "cytoscape" | "jsonld" | "turtle") => {
    try {
      const response = await api.downloadGraph(workspaceId, format);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `domain-graph.${format === "turtle" ? "ttl" : format === "jsonld" ? "jsonld" : "json"}`;
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
        eyebrow={pick("知识结构", "Knowledge structure")}
        title={pick("领域知识图谱", "Domain knowledge map")}
        description={pick("探索知识点之间的联系。点击节点或关系可查看来源与详细信息。", "Explore how knowledge points connect. Select a node or relationship to view details and sources.")}
        actions={
          <details className="relative">
              <summary className="secondary-button cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <Download className="h-4 w-4" />
                {pick("导出图谱", "Export map")}
              </summary>
              <div className="absolute right-0 top-11 z-20 w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => void exportGraph("cytoscape")}
                  className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Cytoscape（JSON）
                </button>
                <button
                  type="button"
                  onClick={() => void exportGraph("jsonld")}
                  className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  JSON-LD
                </button>
                <button
                  type="button"
                  onClick={() => void exportGraph("turtle")}
                  className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Turtle（TTL）
                </button>
              </div>
          </details>
        }
      />
      {exportError !== null && (
        <div className="mb-4">
          <ErrorState
            error={exportError}
            onRetry={() => void exportGraph("cytoscape")}
          />
        </div>
      )}
      <div className="mb-4">
        <RuntimeModelBadge role="graph" label={pick("图谱分析", "Graph analysis")} />
      </div>
      <div className="toolbar-card mb-4 grid gap-3 md:grid-cols-[minmax(16rem,1fr)_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            aria-label={pick("搜索领域图节点", "Search domain map nodes")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="form-input pl-9"
            placeholder={pick("搜索知识点", "Search knowledge points")}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Filter className="h-4 w-4 text-slate-400" />
          <span className="text-slate-500">{pick("类型", "Type")}</span>
          {types.slice(0, 8).map((type) => (
            <button
              type="button"
              key={type}
              onClick={() => toggle(type, typeFilter, setTypeFilter)}
              aria-pressed={typeFilter.includes(type)}
              className={`filter-chip ${typeFilter.includes(type) ? "filter-chip-active" : ""}`}
            >
              {domainNodeTypeLabel(type, locale)}
            </button>
          ))}
          {relations.length > 0 && (
            <span className="ml-2 text-slate-500">{pick("关系", "Relationship")}</span>
          )}
          {relations.slice(0, 6).map((relation) => (
            <button
              type="button"
              key={relation}
              onClick={() =>
                toggle(relation, relationFilter, setRelationFilter)
              }
              aria-pressed={relationFilter.includes(relation)}
              className={`filter-chip ${relationFilter.includes(relation) ? "filter-chip-active" : ""}`}
            >
              {relationTypeLabel(relation, locale)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setShowTechnicalNodes((value) => !value);
              setTypeFilter([]);
              setRelationFilter([]);
            }}
            aria-pressed={showTechnicalNodes}
            className={`filter-chip ${showTechnicalNodes ? "filter-chip-active" : ""}`}
          >
            {showTechnicalNodes ? pick("隐藏技术节点", "Hide technical nodes") : pick("显示技术节点", "Show technical nodes")}
          </button>
          {(typeFilter.length > 0 || relationFilter.length > 0) && (
            <button
              type="button"
              className="quiet-button min-h-8 px-2"
              onClick={() => {
                setTypeFilter([]);
                setRelationFilter([]);
              }}
            >
              {pick("清除筛选", "Clear filters")}
            </button>
          )}
        </div>
      </div>
      {focusNodeId && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200">
          {subgraph.isLoading ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Focus className="h-4 w-4" />
          )}
          <span>
            {subgraph.isLoading ? pick("正在加载局部子图", "Loading focused map") : pick("正在查看局部子图", "Viewing focused map")}
          </span>
          {subgraph.isError && (
            <button
              type="button"
              onClick={() => void subgraph.refetch()}
              className="underline"
            >
              {pick("加载失败，重试", "Loading failed. Retry")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setFocusNodeId(null)}
            className="quiet-button ml-auto min-h-8 px-2"
          >
            <Undo2 className="h-3.5 w-3.5" />
            {pick("返回完整图谱", "Return to full map")}
          </button>
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
        <GraphCanvas
          graph={productGraph ?? data}
          search={search}
          nodeTypes={typeFilter}
          relationTypes={relationFilter}
          density={preferences.graphDensity}
          labelDensity={preferences.graphLabelDensity}
          selectedId={selectedNode?.id ?? selectedEdge?.id ?? null}
          onNodeSelect={handleNode}
          onEdgeSelect={handleEdge}
        />
        <aside className="space-y-4">
          <div className="surface-card p-4">
            <h2 className="text-sm font-semibold">{pick("图谱概览", "Map overview")}</h2>
            {manifest.isError && (
              <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300" role="status">
                {pick("汇总数据暂时不可用，以下展示图谱内可计算的数据。", "Summary data is unavailable. Values calculated from the visible map are shown instead.")}
                <button
                  type="button"
                  className="ml-1 underline"
                  onClick={() => void manifest.refetch()}
                >
                  {pick("重试", "Retry")}
                </button>
              </p>
            )}
            <dl className="mt-3 space-y-2 text-xs">
              <Metric
                label={pick("知识点", "Knowledge points")}
                value={
                  manifest.data?.data.knowledge_point_count ??
                  data.elements.nodes.filter(
                    (node) => node.data.type === "KnowledgePoint",
                  ).length
                }
              />
              <Metric
                label={pick("当前关系", "Relationships")}
                value={productGraph?.elements.edges.length ?? data.elements.edges.length}
              />
              <Metric
                label={pick("来源", "Sources")}
                value={
                  manifest.data?.data.source_count ??
                  (manifest.isLoading ? pick("读取中", "Loading") : pick("暂不可用", "Unavailable"))
                }
              />
              <Metric
                label={pick("版本状态", "Version status")}
                value={
                  typeof data.meta.revision_id === "string"
                    ? pick("已加载", "Loaded")
                    : pick("暂无", "Unavailable")
                }
              />
            </dl>
            <Link
              to="/history/domain"
              className="mt-3 inline-flex text-xs font-medium text-[#3157D5] hover:underline"
            >
              {pick("查看版本记录 →", "View version history →")}
            </Link>
          </div>
          <div className="surface-card p-4">
            <h2 className="text-sm font-semibold">{pick("图例", "Legend")}</h2>
            <div className="mt-3 space-y-2 text-xs text-slate-500">
              {[
                "Domain",
                "Theory",
                "KnowledgePoint",
                "Definition",
                "Method",
              ].map((type) => (
                <div key={type} className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{
                      background: (
                        {
                          Domain: "#1E3A9E",
                          Theory: "#3157D5",
                          KnowledgePoint: "#5577E8",
                          Definition: "#7B96EF",
                          Method: "#4264C8",
                        } as Record<string, string>
                      )[type],
                    }}
                  />
                  {domainNodeTypeLabel(type, locale)}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
      {detailOpen && (
        <GraphDetailDrawer
          kind={selectedNode ? "node" : "assertion"}
          title={selectedNode ? pick("知识点详情", "Knowledge point details") : pick("知识关系详情", "Relationship details")}
          loading={nodeDetail.isLoading || edgeDetail.isLoading}
          error={nodeDetail.error ?? edgeDetail.error}
          data={
            nodeDetail.data?.data ??
            edgeDetail.data?.data ??
            selectedNode ??
            selectedEdge
          }
          onFocus={
            selectedNode
              ? () => {
                  setFocusNodeId(selectedNode.id);
                  setDetailOpen(false);
                }
              : undefined
          }
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

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-mono text-slate-700 dark:text-slate-200">{value}</dd>
    </div>
  );
}

function GraphDetailDrawer({
  kind,
  title,
  data,
  loading,
  error,
  onFocus,
  onRetry,
  onClose,
}: {
  kind: "node" | "assertion";
  title: string;
  data: unknown;
  loading: boolean;
  error: unknown;
  onFocus?: () => void;
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
      description={pick(`${title}侧边栏`, `${title} panel`)}
      width="lg"
    >
      {loading ? (
        <LoadingState label={pick("正在读取详情", "Loading details")} />
      ) : error ? (
        <div className="mt-4">
          <ErrorState error={error} onRetry={onRetry} />
        </div>
      ) : (
        kind === "node" ? (
          <DomainNodeDetail data={data} onFocus={onFocus} />
        ) : (
          <DomainAssertionDetail data={data} />
        )
      )}
    </Sheet>
  );
}

function jsonObjectArray(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonObject =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      )
    : [];
}
