import { useQuery } from "@tanstack/react-query";
import {
  Download,
  Filter,
  Focus,
  LoaderCircle,
  Search,
  Undo2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/services/api";
import { queryKeys } from "@/lib/queryKeys";
import { rawGraphToCytoscape } from "@/lib/graph";
import { jsonText } from "@/lib/utils";
import { useAppStore } from "@/stores/AppContext";
import type {
  GraphEdgeData,
  GraphNodeData,
  JsonObject,
  JsonValue,
} from "@/types/api";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/States";
import { PageHeader } from "@/components/shared/PageHeader";
import { Sheet } from "@/components/shared/Sheet";

export function DomainGraphPage() {
  const { currentWorkspace, preferences } = useAppStore();
  const workspaceId = currentWorkspace?.id;
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [relationFilter, setRelationFilter] = useState<string[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNodeData | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdgeData | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
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
  const types = useMemo(
    () =>
      Array.from(
        new Set(
          (displayedGraph?.elements.nodes ?? []).map((node) => node.data.type),
        ),
      ).sort(),
    [displayedGraph],
  );
  const relations = useMemo(
    () =>
      Array.from(
        new Set(
          (displayedGraph?.elements.edges ?? []).map(
            (edge) => edge.data.relation_type ?? edge.data.predicate ?? "",
          ),
        ),
      )
        .filter(Boolean)
        .sort(),
    [displayedGraph],
  );
  if (!workspaceId) return <EmptyState title="尚未选择 Workspace" />;
  if (graph.isLoading) return <LoadingState label="正在加载领域知识图谱" />;
  if (graph.isError)
    return (
      <ErrorState error={graph.error} onRetry={() => void graph.refetch()} />
    );
  const data = graph.data;
  if (!data || data.elements.nodes.length === 0)
    return (
      <EmptyState
        title="领域图谱为空"
        description="上传并摄取一份资料，或使用一个已有的 Workspace。"
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
    const response = await api.downloadGraph(workspaceId, format);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `domain-graph.${format === "turtle" ? "ttl" : format === "jsonld" ? "jsonld" : "json"}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div>
      <PageHeader
        eyebrow="Domain graph"
        title="领域知识图谱"
        description="真实 Cytoscape 导出；关系边以 assertion_id 作为唯一身份。"
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void exportGraph("cytoscape")}
              className="secondary-button"
            >
              <Download className="h-4 w-4" />
              Cytoscape
            </button>
            <details className="relative">
              <summary className="secondary-button list-none cursor-pointer">
                <Download className="h-4 w-4" />
                导出
              </summary>
              <div className="absolute right-0 top-11 z-10 w-32 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => void exportGraph("jsonld")}
                  className="block w-full rounded px-2 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  JSON-LD
                </button>
                <button
                  type="button"
                  onClick={() => void exportGraph("turtle")}
                  className="block w-full rounded px-2 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Turtle
                </button>
              </div>
            </details>
          </div>
        }
      />
      <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="form-input pl-9"
            placeholder="搜索节点名称或 ID"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Filter className="h-4 w-4 text-slate-400" />
          <span className="text-slate-500">类型</span>
          {types.slice(0, 8).map((type) => (
            <button
              type="button"
              key={type}
              onClick={() => toggle(type, typeFilter, setTypeFilter)}
              className={`rounded-md border px-2 py-1 ${typeFilter.includes(type) ? "border-[#3157D5] bg-indigo-50 text-[#3157D5]" : "border-slate-200 text-slate-500 dark:border-slate-700"}`}
            >
              {type}
            </button>
          ))}
          <span className="ml-2 text-slate-500">关系</span>
          {relations.slice(0, 6).map((relation) => (
            <button
              type="button"
              key={relation}
              onClick={() =>
                toggle(relation, relationFilter, setRelationFilter)
              }
              className={`rounded-md border px-2 py-1 ${relationFilter.includes(relation) ? "border-[#3157D5] bg-indigo-50 text-[#3157D5]" : "border-slate-200 text-slate-500 dark:border-slate-700"}`}
            >
              {relation}
            </button>
          ))}
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
            {subgraph.isLoading ? "正在加载局部子图" : "正在查看局部子图"} ·{" "}
            {focusNodeId.slice(0, 8)}
          </span>
          {subgraph.isError && (
            <button
              type="button"
              onClick={() => void subgraph.refetch()}
              className="underline"
            >
              加载失败，重试
            </button>
          )}
          <button
            type="button"
            onClick={() => setFocusNodeId(null)}
            className="quiet-button ml-auto min-h-8 px-2"
          >
            <Undo2 className="h-3.5 w-3.5" />
            返回完整图谱
          </button>
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
        <GraphCanvas
          graph={displayedGraph ?? data}
          search={search}
          nodeTypes={typeFilter}
          relationTypes={relationFilter}
          density={preferences.graphDensity}
          onNodeSelect={handleNode}
          onEdgeSelect={handleEdge}
        />
        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-sm font-semibold">Manifest</h2>
            <dl className="mt-3 space-y-2 text-xs">
              <Metric
                label="知识点"
                value={manifest.data?.data.knowledge_point_count ?? 0}
              />
              <Metric
                label="关系"
                value={
                  manifest.data?.data.assertion_count ??
                  data.elements.edges.length
                }
              />
              <Metric
                label="来源"
                value={manifest.data?.data.source_count ?? 0}
              />
              <Metric
                label="版本"
                value={
                  typeof data.meta.revision_id === "string"
                    ? data.meta.revision_id.slice(0, 8)
                    : "—"
                }
              />
            </dl>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-sm font-semibold">图例</h2>
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
                  {type}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
      {detailOpen && (
        <GraphDetailDrawer
          title={selectedNode ? "节点详情" : "RelationAssertion 详情"}
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
  title,
  data,
  loading,
  error,
  onFocus,
  onClose,
}: {
  title: string;
  data: unknown;
  loading: boolean;
  error: unknown;
  onFocus?: () => void;
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
        <LoadingState label="正在读取详情" />
      ) : error ? (
        <div className="mt-4">
          <ErrorState error={error} />
        </div>
      ) : (
        <>
          {onFocus && (
            <button
              type="button"
              onClick={onFocus}
              className="secondary-button mt-5"
            >
              <Focus className="h-4 w-4" />
              加载局部子图
            </button>
          )}
          <pre className="mt-4 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-5 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            {jsonText(data)}
          </pre>
        </>
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
