import {
  ArrowRight,
  GitBranch,
  List,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Scan,
} from "lucide-react";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { graphNodeLabel, graphNodeType } from "@/lib/graph";
import { cn, displayPercent } from "@/lib/utils";
import type { CytoscapeGraph, GraphEdgeData, GraphNodeData } from "@/types/api";

export type GraphLabelDensity = "minimal" | "balanced" | "detailed";
type GraphView = "graph" | "list";
type NodeShape =
  | "ellipse"
  | "round-rectangle"
  | "hexagon"
  | "diamond"
  | "tag"
  | "star"
  | "vee"
  | "octagon"
  | "rectangle"
  | "round-diamond"
  | "pentagon";

interface GraphCanvasProps {
  graph: CytoscapeGraph;
  selectedId?: string | null;
  search?: string;
  nodeTypes?: string[];
  relationTypes?: string[];
  density?: "comfortable" | "compact" | "dense";
  labelDensity?: GraphLabelDensity;
  onNodeSelect?: (node: GraphNodeData) => void;
  onEdgeSelect?: (edge: GraphEdgeData) => void;
  className?: string;
}

interface VisibleGraphElements {
  nodes: Array<{ data: GraphNodeData }>;
  edges: Array<{ data: GraphEdgeData }>;
}

const nodeColors: Record<string, string> = {
  Domain: "#1E3A9E",
  Theory: "#3157D5",
  KnowledgePoint: "#5577E8",
  Definition: "#7B96EF",
  Method: "#4264C8",
  Example: "#0EA5A4",
  Counterexample: "#D97706",
  Misconception: "#DC2626",
  SourceDocument: "#64748B",
  Learner: "#16A34A",
  LearnerKnowledgeState: "#0F8A5F",
  LearnerGraphResource: "#64748B",
};

const nodeShapes: Record<string, NodeShape> = {
  Domain: "round-rectangle",
  Theory: "hexagon",
  KnowledgePoint: "ellipse",
  Definition: "diamond",
  Method: "tag",
  Example: "star",
  Counterexample: "vee",
  Misconception: "octagon",
  SourceDocument: "rectangle",
  Learner: "round-diamond",
  LearnerKnowledgeState: "pentagon",
};

export function graphNodeShape(type: string): NodeShape {
  return nodeShapes[type] ?? "ellipse";
}

export function filterGraphElements(
  graph: CytoscapeGraph,
  search: string,
  nodeTypes?: string[],
  relationTypes?: string[],
): VisibleGraphElements {
  const query = search.trim().toLowerCase();
  const nodes = graph.elements.nodes.filter((node) => {
    const typeOk = !nodeTypes?.length || nodeTypes.includes(graphNodeType(node.data));
    const textOk =
      !query ||
      graphNodeLabel(node.data).toLowerCase().includes(query) ||
      node.data.id.toLowerCase().includes(query);
    return typeOk && textOk;
  });
  const nodeIds = new Set(nodes.map((node) => node.data.id));
  const edges = graph.elements.edges.filter((edge) => {
    const relation = edge.data.relation_type ?? edge.data.predicate ?? "";
    return (
      nodeIds.has(edge.data.source) &&
      nodeIds.has(edge.data.target) &&
      (!relationTypes?.length || relationTypes.includes(relation))
    );
  });
  return { nodes, edges };
}

function edgeDisplayLabel(edge: GraphEdgeData): string {
  return edge.natural_language_description ?? edge.relation_type ?? edge.predicate ?? "相关";
}

export function GraphCanvas({
  graph,
  selectedId,
  search = "",
  nodeTypes,
  relationTypes,
  density = "comfortable",
  labelDensity = "balanced",
  onNodeSelect,
  onEdgeSelect,
  className,
}: GraphCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const onNodeSelectRef = useRef(onNodeSelect);
  const onEdgeSelectRef = useRef(onEdgeSelect);
  const selectedIdRef = useRef(selectedId);
  onNodeSelectRef.current = onNodeSelect;
  onEdgeSelectRef.current = onEdgeSelect;
  selectedIdRef.current = selectedId;
  const [fullScreen, setFullScreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState<GraphView>("graph");
  const visible = useMemo(
    () => filterGraphElements(graph, search, nodeTypes, relationTypes),
    [graph, nodeTypes, relationTypes, search],
  );

  useEffect(() => {
    if (!hostRef.current || view !== "graph") return undefined;
    const elements: ElementDefinition[] = [
      ...visible.nodes.map((node) => ({ data: { ...node.data } })),
      ...visible.edges.map((edge) => ({
        data: { ...edge.data, display_label: edgeDisplayLabel(edge.data) },
      })),
    ];
    const cy = cytoscape({
      container: hostRef.current,
      elements,
      minZoom: 0.15,
      maxZoom: 4,
      wheelSensitivity: 0.18,
      style: [
        {
          selector: "node",
          style: {
            label: labelDensity === "minimal" ? "" : "data(label)",
            shape: (element) => {
              const data = element.data() as GraphNodeData;
              return graphNodeShape(graphNodeType(data));
            },
            "background-color": (element) => {
              const data = element.data() as GraphNodeData;
              return nodeColors[graphNodeType(data)] ?? "#5577E8";
            },
            color: "#172554",
            "font-size": `${density === "dense" ? 8 : density === "compact" ? 9 : 10}px`,
            "text-valign": "bottom",
            "text-margin-y": 7,
            "text-wrap": "ellipsis",
            "text-max-width": `${density === "dense" ? 80 : 120}px`,
            width: density === "dense" ? 22 : 28,
            height: density === "dense" ? 22 : 28,
            "border-width": 2,
            "border-color": "#FFFFFF",
            "overlay-opacity": 0,
          },
        },
        {
          selector: "node[epistemic_status = 'contested'], node[epistemic_status = 'conflicting']",
          style: {
            "border-color": "#DC2626",
            "border-style": "dashed",
            "border-width": 3,
          },
        },
        {
          selector: "node[active = false]",
          style: { opacity: 0.45 },
        },
        {
          selector: "edge",
          style: {
            width: 1.2,
            "line-color": "#A9B7D9",
            "target-arrow-color": "#A9B7D9",
            "target-arrow-shape": "triangle",
            "source-arrow-shape": "none",
            "curve-style": "bezier",
            label: "",
            color: "#475569",
            "font-size": "8px",
            "text-background-color": "#FFFFFF",
            "text-background-opacity": 0.9,
            "text-background-padding": "2px",
            opacity: 0.65,
          },
        },
        {
          selector: "edge.show-label, edge:active, edge:selected",
          style: { label: "data(display_label)" },
        },
        {
          selector: "edge[active = false]",
          style: {
            "line-style": "dashed",
            opacity: 0.35,
          },
        },
        {
          selector: ".context",
          style: {
            "border-color": "#3157D5",
            "line-color": "#5577E8",
            "target-arrow-color": "#5577E8",
            opacity: 1,
          },
        },
        {
          selector: ":selected",
          style: {
            "border-color": "#F59E0B",
            "border-width": 4,
            "line-color": "#F59E0B",
            "target-arrow-color": "#F59E0B",
            opacity: 1,
          },
        },
        {
          selector: ".search-hit",
          style: { "border-color": "#F59E0B", "border-width": 4 },
        },
      ],
      layout: {
        name: visible.nodes.length > 80 ? "grid" : "cose",
        animate: false,
        fit: true,
        padding: 36,
      },
    });
    cyRef.current = cy;

    const updateEdgeLabels = () => {
      const threshold = labelDensity === "detailed" ? 0 : labelDensity === "balanced" ? 1.35 : 3;
      cy.edges().toggleClass("show-label", cy.zoom() >= threshold);
    };
    updateEdgeLabels();
    cy.on("tap", "node", (event) => {
      const target = event.target as cytoscape.NodeSingular;
      cy.elements().removeClass("context");
      target.closedNeighborhood().addClass("context");
      target.select();
      onNodeSelectRef.current?.(target.data() as GraphNodeData);
    });
    cy.on("tap", "edge", (event) => {
      const target = event.target as cytoscape.EdgeSingular;
      cy.elements().removeClass("context");
      target.connectedNodes().add(target).addClass("context");
      target.select();
      onEdgeSelectRef.current?.(target.data() as GraphEdgeData);
    });
    cy.on("mouseover", "edge", (event) => {
      const target = event.target as cytoscape.EdgeSingular;
      target.addClass("show-label");
    });
    cy.on("mouseout", "edge", () => updateEdgeLabels());
    cy.on("zoom", () => {
      setZoom(cy.zoom());
      updateEdgeLabels();
    });
    if (selectedIdRef.current) {
      const selected = cy.$id(selectedIdRef.current);
      selected.select();
      selected.closedNeighborhood().addClass("context");
    }
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [
    density,
    labelDensity,
    view,
    visible.edges,
    visible.nodes,
  ]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || view !== "graph") return;
    cy.elements().unselect().removeClass("context");
    if (!selectedId) return;
    const selected = cy.$id(selectedId);
    selected.select();
    selected.closedNeighborhood().addClass("context");
  }, [selectedId, view]);

  useEffect(() => {
    if (!fullScreen) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setFullScreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullScreen]);

  const adjustZoom = (delta: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({
      level: Math.max(0.15, Math.min(4, cy.zoom() + delta)),
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  };
  const fit = () => cyRef.current?.fit(undefined, 36);
  const filtered = visible.nodes.length !== graph.elements.nodes.length || visible.edges.length !== graph.elements.edges.length;

  return (
    <section
      className={cn(
        "relative min-h-[420px] overflow-hidden rounded-xl border border-slate-200 bg-[#F8FAFF] dark:border-slate-700 dark:bg-slate-900",
        fullScreen && "fixed inset-3 z-50 min-h-0 bg-white shadow-2xl dark:bg-slate-950",
        className,
      )}
      aria-label="知识图谱浏览器"
    >
      <div className="absolute left-3 top-3 z-10 flex rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900/95">
        <button
          type="button"
          onClick={() => setView("graph")}
          className={cn("rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#3157D5]", view === "graph" ? "bg-indigo-50 text-[#3157D5] dark:bg-indigo-950" : "text-slate-500")}
          aria-pressed={view === "graph"}
          aria-label="切换到图谱视图"
        >
          <GitBranch className="mr-1 inline h-3.5 w-3.5" />图谱
        </button>
        <button
          type="button"
          onClick={() => setView("list")}
          className={cn("rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#3157D5]", view === "list" ? "bg-indigo-50 text-[#3157D5] dark:bg-indigo-950" : "text-slate-500")}
          aria-pressed={view === "list"}
          aria-label="切换到列表视图"
        >
          <List className="mr-1 inline h-3.5 w-3.5" />列表
        </button>
      </div>

      {view === "graph" ? (
        <div ref={hostRef} className="h-full min-h-[420px] w-full" role="application" aria-label={`知识图谱，${visible.nodes.length} 个节点、${visible.edges.length} 条有向关系。可切换列表视图进行键盘浏览。`} />
      ) : (
        <GraphListView
          nodes={visible.nodes.map((node) => node.data)}
          edges={visible.edges.map((edge) => edge.data)}
          selectedId={selectedId}
          onNodeSelect={onNodeSelect}
          onEdgeSelect={onEdgeSelect}
        />
      )}

      {view === "graph" && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900/95">
          <button type="button" onClick={() => adjustZoom(0.25)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#3157D5]" aria-label="放大图谱">
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => adjustZoom(-0.25)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#3157D5]" aria-label="缩小图谱">
            <Minus className="h-4 w-4" />
          </button>
          <button type="button" onClick={fit} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#3157D5]" aria-label="适配全图">
            <Scan className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setFullScreen((value) => !value)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#3157D5]" aria-label={fullScreen ? "退出全屏" : "全屏查看图谱"}>
            {fullScreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      )}

      <div className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-2 rounded bg-white/90 px-2 py-1 font-mono text-[10px] text-slate-500 shadow-sm dark:bg-slate-900/90">
        <span>{visible.nodes.length} 节点</span>
        <span>{visible.edges.length} 关系</span>
        <span>{filtered ? "筛选已启用" : "显示全部"}</span>
        {view === "graph" && <span>{displayPercent(Math.min(1, zoom / 4))} 缩放</span>}
        {view === "graph" && (
          <button type="button" onClick={fit} className="rounded text-[#3157D5] underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-[#3157D5]">
            适配全图
          </button>
        )}
      </div>
    </section>
  );
}

interface GraphListViewProps {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  selectedId?: string | null;
  onNodeSelect?: (node: GraphNodeData) => void;
  onEdgeSelect?: (edge: GraphEdgeData) => void;
}

export function GraphListView({
  nodes,
  edges,
  selectedId,
  onNodeSelect,
  onEdgeSelect,
}: GraphListViewProps) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const items = useMemo(
    () => [
      ...nodes.map((node) => ({ kind: "node" as const, id: node.id, value: node })),
      ...edges.map((edge) => ({ kind: "edge" as const, id: edge.id, value: edge })),
    ],
    [edges, nodes],
  );

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [items.length]);

  const move = (nextIndex: number) => {
    if (!items.length) return;
    const normalized = (nextIndex + items.length) % items.length;
    setActiveIndex(normalized);
    buttonRefs.current[normalized]?.focus();
  };
  const activate = (index: number) => {
    const item = items[index];
    if (!item) return;
    if (item.kind === "node") onNodeSelect?.(item.value);
    else onEdgeSelect?.(item.value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      move(activeIndex + 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      move(activeIndex - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activate(activeIndex);
    } else if (event.key === "Escape") {
      (event.currentTarget.ownerDocument.activeElement as HTMLElement | null)?.blur();
    }
  };
  const nodeLabels = new Map(nodes.map((node) => [node.id, graphNodeLabel(node)]));

  return (
    <div className="max-h-[620px] min-h-[420px] overflow-auto px-4 pb-16 pt-16" onKeyDown={onKeyDown} aria-label="知识图谱列表，可用方向键选择，Enter 打开详情，Escape 退出焦点">
      <section aria-labelledby="graph-node-list-heading">
        <h2 id="graph-node-list-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">节点（{nodes.length}）</h2>
        {nodes.length ? (
          <ul className="grid gap-2 md:grid-cols-2" role="listbox" aria-label="图谱节点">
            {nodes.map((node, index) => (
              <li key={node.id}>
                <button
                  ref={(element) => { buttonRefs.current[index] = element; }}
                  type="button"
                  tabIndex={index === activeIndex ? 0 : -1}
                  role="option"
                  aria-selected={selectedId === node.id}
                  onFocus={() => setActiveIndex(index)}
                  onClick={() => onNodeSelect?.(node)}
                  className={cn("flex w-full items-center gap-3 rounded-lg border bg-white p-3 text-left text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#3157D5] dark:bg-slate-950", selectedId === node.id ? "border-amber-500" : "border-slate-200 hover:border-indigo-300 dark:border-slate-700")}
                >
                  <span className="h-4 w-4 shrink-0 rounded-sm border-2 border-white shadow" style={{ backgroundColor: nodeColors[graphNodeType(node)] ?? "#5577E8" }} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{graphNodeLabel(node)}</span>
                    <span className="block text-[11px] text-slate-500">{graphNodeType(node)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">当前筛选条件下没有节点。</p>
        )}
      </section>

      <section className="mt-6" aria-labelledby="graph-edge-list-heading">
        <h2 id="graph-edge-list-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">有向关系（{edges.length}）</h2>
        {edges.length ? (
          <ul className="space-y-2" role="listbox" aria-label="图谱关系">
            {edges.map((edge, edgeIndex) => {
              const index = nodes.length + edgeIndex;
              return (
                <li key={edge.id}>
                  <button
                    ref={(element) => { buttonRefs.current[index] = element; }}
                    type="button"
                    tabIndex={index === activeIndex ? 0 : -1}
                    role="option"
                    aria-selected={selectedId === edge.id}
                    onFocus={() => setActiveIndex(index)}
                    onClick={() => onEdgeSelect?.(edge)}
                    className={cn("grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-lg border bg-white p-3 text-left text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-[#3157D5] dark:bg-slate-950", selectedId === edge.id ? "border-amber-500" : "border-slate-200 hover:border-indigo-300 dark:border-slate-700")}
                  >
                    <span className="truncate text-right">{nodeLabels.get(edge.source) ?? edge.source}</span>
                    <span className="flex flex-col items-center text-[#3157D5]">
                      <span className="max-w-48 truncate font-medium">{edgeDisplayLabel(edge)}</span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="truncate">{nodeLabels.get(edge.target) ?? edge.target}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">当前筛选条件下没有关系。</p>
        )}
      </section>
    </div>
  );
}
