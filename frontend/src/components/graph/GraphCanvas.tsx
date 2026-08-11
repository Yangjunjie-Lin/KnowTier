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
import { domainNodeTypeLabel, relationTypeLabel } from "@/lib/domainDetails";
import {
  learnerGraphEdgeRelationTypes,
  learnerGraphNodeTypeLabel,
  learnerGraphRelationLabel,
} from "@/lib/learnerGraphPresentation";
import { cn, displayPercent } from "@/lib/utils";
import type { CytoscapeGraph, GraphEdgeData, GraphNodeData } from "@/types/api";
import type { UiLocale } from "@/types/app";

export type GraphLabelDensity = "minimal" | "balanced" | "detailed";
type GraphView = "graph" | "list";
export type GraphPresentation = "domain" | "learner";
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
  presentation?: GraphPresentation;
  locale?: UiLocale;
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
  includeInternalIds = true,
): VisibleGraphElements {
  const query = search.trim().toLowerCase();
  const nodes = graph.elements.nodes.filter((node) => {
    const typeOk = !nodeTypes?.length || nodeTypes.includes(graphNodeType(node.data));
    const textOk =
      !query ||
      graphNodeLabel(node.data).toLowerCase().includes(query) ||
      (includeInternalIds && node.data.id.toLowerCase().includes(query));
    return typeOk && textOk;
  });
  const nodeIds = new Set(nodes.map((node) => node.data.id));
  const edges = graph.elements.edges.filter((edge) => {
    const relations = includeInternalIds
      ? [edge.data.relation_type ?? edge.data.predicate ?? ""]
      : learnerGraphEdgeRelationTypes(edge.data);
    return (
      nodeIds.has(edge.data.source) &&
      nodeIds.has(edge.data.target) &&
      (!relationTypes?.length ||
        relationTypes.some((relation) => relations.includes(relation)))
    );
  });
  return { nodes, edges };
}

function edgeDisplayLabel(
  edge: GraphEdgeData,
  presentation: GraphPresentation,
  locale: UiLocale,
): string {
  if (typeof edge.display_label === "string" && edge.display_label.trim())
    return edge.display_label;
  if (presentation === "learner") {
    return learnerGraphRelationLabel(
      edge.relation_type ?? edge.predicate ?? "",
      locale,
    );
  }
  return (
    edge.natural_language_description ??
    relationTypeLabel(edge.relation_type ?? edge.predicate ?? "RELATED", locale)
  );
}

function learnerNodeColor(node: GraphNodeData): string {
  const type = graphNodeType(node);
  if (type === "Learner") return "#3157D5";
  if (type.includes("Resource") || type === "MasteryEvidence") return "#7C3AED";
  const score = node.mastery_score;
  if (typeof score !== "number") return "#64748B";
  if (score >= 0.8) return "#16A34A";
  if (score >= 0.5) return "#0EA5A4";
  return "#D97706";
}

function localized(locale: UiLocale, chinese: string, english: string): string {
  return locale === "en" ? english : chinese;
}

function learnerNodeSubtitle(node: GraphNodeData, locale: UiLocale): string {
  const type = graphNodeType(node);
  if (type !== "LearnerKnowledgeState")
    return learnerGraphNodeTypeLabel(type, locale);
  if (typeof node.mastery_score !== "number")
    return localized(locale, "知识点 · 待评估", "Knowledge point · Not assessed");
  const status =
    typeof node.learner_status === "string"
      ? node.learner_status
      : localized(locale, "学习中", "In progress");
  return localized(
    locale,
    `${status} · 掌握 ${displayPercent(node.mastery_score)}`,
    `${status} · ${displayPercent(node.mastery_score)} mastery`,
  );
}

function fitGraphAtReadableScale(cy: Core, nodeCount: number): void {
  cy.fit(undefined, 36);
  const maximumFitZoom = nodeCount <= 12 ? 1.25 : nodeCount <= 40 ? 1.75 : 4;
  if (cy.zoom() <= maximumFitZoom) return;
  cy.zoom({
    level: maximumFitZoom,
    renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
  });
  cy.center();
}

export function GraphCanvas({
  graph,
  selectedId,
  search = "",
  nodeTypes,
  relationTypes,
  density = "comfortable",
  labelDensity = "balanced",
  presentation = "domain",
  locale = "zh-CN",
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
  const [view, setView] = useState<GraphView>(() =>
    window.matchMedia("(max-width: 767px)").matches ? "list" : "graph",
  );
  const visible = useMemo(
    () =>
      filterGraphElements(
        graph,
        search,
        nodeTypes,
        relationTypes,
        presentation !== "learner",
      ),
    [graph, nodeTypes, presentation, relationTypes, search],
  );

  useEffect(() => {
    if (!hostRef.current || view !== "graph") return undefined;
    const showLearnerEdgeLabels =
      presentation === "learner" &&
      labelDensity === "detailed" &&
      visible.edges.length <= 12;
    const elements: ElementDefinition[] = [
      ...visible.nodes.map((node) => ({
        data: {
          ...node.data,
          is_inactive: node.data.active === false ? 1 : 0,
        },
      })),
      ...visible.edges.map((edge) => ({
        data: {
          ...edge.data,
          is_inactive:
            edge.data.active === false ||
            edge.data.is_active === false ||
            Boolean(edge.data.valid_to)
              ? 1
              : 0,
          display_label: edgeDisplayLabel(edge.data, presentation, locale),
        },
      })),
    ];
    const cy = cytoscape({
      container: hostRef.current,
      elements,
      minZoom: 0.15,
      maxZoom: 4,
      style: [
        {
          selector: "node",
          style: {
            label: labelDensity === "minimal" ? "" : "data(label)",
            shape: (element) => {
              const data = element.data() as GraphNodeData;
              if (presentation === "learner") {
                return graphNodeType(data) === "Learner" ? "round-rectangle" : "ellipse";
              }
              return graphNodeShape(graphNodeType(data));
            },
            "background-color": (element) => {
              const data = element.data() as GraphNodeData;
              return presentation === "learner"
                ? learnerNodeColor(data)
                : nodeColors[graphNodeType(data)] ?? "#5577E8";
            },
            color: "#172554",
            "font-size": `${density === "dense" ? 8 : density === "compact" ? 9 : 10}px`,
            "text-valign": "bottom",
            "text-margin-y": 7,
            "text-wrap": "ellipsis",
            "text-max-width": `${
              visible.nodes.length <= 12 ? 180 : density === "dense" ? 80 : 120
            }px`,
            width:
              presentation === "learner"
                ? density === "dense"
                  ? 26
                  : 34
                : density === "dense"
                  ? 22
                  : 28,
            height:
              presentation === "learner"
                ? density === "dense"
                  ? 26
                  : 34
                : density === "dense"
                  ? 22
                  : 28,
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
          selector: "node[is_inactive = 1]",
          style: { opacity: 0.45 },
        },
        {
          selector: "edge",
          style: {
            width: presentation === "learner" ? 1.6 : 1.2,
            "line-color": "#A9B7D9",
            "target-arrow-color": "#A9B7D9",
            "target-arrow-shape": (element) =>
              presentation === "learner" && element.data("mixed_direction")
                ? "none"
                : "triangle",
            "source-arrow-shape": "none",
            "curve-style": presentation === "learner" ? "straight" : "bezier",
            "line-cap": "round",
            label:
              showLearnerEdgeLabels
                ? "data(display_label)"
                : "",
            color: "#475569",
            "font-size": "8px",
            "text-rotation": presentation === "learner" ? "autorotate" : "none",
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
          selector: "edge:selected",
          style: { width: 3 },
        },
        {
          selector: "edge[is_inactive = 1]",
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
      layout:
        visible.edges.length === 0
          ? {
              name: "grid",
              animate: false,
              fit: true,
              padding: 72,
              avoidOverlap: true,
              spacingFactor: 1,
            }
          : {
              name: visible.nodes.length > 80 ? "grid" : "cose",
              animate: false,
              fit: true,
              padding: presentation === "learner" ? 52 : 36,
              ...(presentation === "learner"
                ? {
                    nodeRepulsion: density === "dense" ? 3000 : 6000,
                    idealEdgeLength: density === "dense" ? 90 : 140,
                    edgeElasticity: 100,
                    componentSpacing: 80,
                    nodeOverlap: 24,
                  }
                : {}),
            },
    });
    cyRef.current = cy;
    fitGraphAtReadableScale(cy, visible.nodes.length);
    setZoom(cy.zoom());

    const updateEdgeLabels = () => {
      const threshold =
        showLearnerEdgeLabels
          ? 0
          : labelDensity === "detailed"
            ? 0
            : labelDensity === "balanced"
              ? 1.35
              : 3;
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
    locale,
    presentation,
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
  const fit = () => {
    const cy = cyRef.current;
    if (!cy) return;
    fitGraphAtReadableScale(cy, visible.nodes.length);
    setZoom(cy.zoom());
  };
  const filtered = visible.nodes.length !== graph.elements.nodes.length || visible.edges.length !== graph.elements.edges.length;

  return (
    <section
      className={cn(
        "relative min-h-[440px] overflow-hidden rounded-2xl border border-slate-200 bg-[radial-gradient(circle_at_50%_20%,#ffffff_0%,#f6f8ff_62%,#eef2ff_100%)] shadow-[0_1px_2px_rgba(15,23,42,0.03),0_12px_32px_rgba(15,23,42,0.04)] dark:border-slate-700 dark:bg-slate-900",
        fullScreen && "fixed inset-2 z-50 min-h-0 bg-white shadow-2xl sm:inset-3 dark:bg-slate-950",
        className,
      )}
      aria-label={localized(locale, "知识图谱浏览器", "Knowledge graph browser")}
    >
      <div className="absolute left-3 top-3 z-10 flex rounded-xl border border-slate-200 bg-white/95 p-1 shadow-md backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <button
          type="button"
          onClick={() => setView("graph")}
          className={cn("rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#3157D5]", view === "graph" ? "bg-indigo-50 text-[#3157D5] dark:bg-indigo-950" : "text-slate-500")}
          aria-pressed={view === "graph"}
          aria-label={localized(locale, "切换到图谱视图", "Switch to graph view")}
        >
          <GitBranch className="mr-1 inline h-3.5 w-3.5" />
          {localized(locale, "图谱", "Graph")}
        </button>
        <button
          type="button"
          onClick={() => setView("list")}
          className={cn("rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#3157D5]", view === "list" ? "bg-indigo-50 text-[#3157D5] dark:bg-indigo-950" : "text-slate-500")}
          aria-pressed={view === "list"}
          aria-label={localized(locale, "切换到列表视图", "Switch to list view")}
        >
          <List className="mr-1 inline h-3.5 w-3.5" />
          {localized(locale, "列表", "List")}
        </button>
      </div>

      {view === "graph" ? (
        <div
          ref={hostRef}
          className="h-full min-h-[440px] w-full"
          role="application"
          aria-label={localized(
            locale,
            `知识图谱，${visible.nodes.length} 个节点、${visible.edges.length} 条有向关系。可切换列表视图进行键盘浏览。`,
            `Knowledge graph with ${visible.nodes.length} nodes and ${visible.edges.length} directed links. Switch to list view for keyboard navigation.`,
          )}
        />
      ) : (
        <GraphListView
          nodes={visible.nodes.map((node) => node.data)}
          edges={visible.edges.map((edge) => edge.data)}
          selectedId={selectedId}
          onNodeSelect={onNodeSelect}
          onEdgeSelect={onEdgeSelect}
          presentation={presentation}
          locale={locale}
        />
      )}

      {view === "graph" && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-md backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <button type="button" onClick={() => adjustZoom(0.25)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#3157D5]" aria-label={localized(locale, "放大图谱", "Zoom in")}>
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => adjustZoom(-0.25)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#3157D5]" aria-label={localized(locale, "缩小图谱", "Zoom out")}>
            <Minus className="h-4 w-4" />
          </button>
          <button type="button" onClick={fit} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#3157D5]" aria-label={localized(locale, "适配全图", "Fit graph")}>
            <Scan className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setFullScreen((value) => !value)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#3157D5]" aria-label={fullScreen ? localized(locale, "退出全屏", "Exit full screen") : localized(locale, "全屏查看图谱", "View graph full screen")}>
            {fullScreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      )}

      <div className="absolute bottom-3 left-3 right-3 z-10 flex flex-wrap items-center gap-x-2 rounded-lg border border-slate-200/70 bg-white/90 px-2.5 py-1.5 text-[11px] text-slate-600 shadow-sm backdrop-blur sm:right-auto dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-400">
        <span>
          {presentation === "learner"
            ? localized(
                locale,
                `${visible.nodes.filter(({ data }) => graphNodeType(data) === "LearnerKnowledgeState").length} 个知识点`,
                `${visible.nodes.filter(({ data }) => graphNodeType(data) === "LearnerKnowledgeState").length} knowledge points`,
              )
            : localized(locale, `${visible.nodes.length} 个节点`, `${visible.nodes.length} nodes`)}
        </span>
        <span>{localized(locale, `${visible.edges.length} 条关系`, `${visible.edges.length} links`)}</span>
        <span>{filtered ? localized(locale, "筛选已启用", "Filtered") : localized(locale, "显示全部", "Showing all")}</span>
        {view === "graph" && <span>{localized(locale, `${Math.round(zoom * 100)}% 缩放`, `${Math.round(zoom * 100)}% zoom`)}</span>}
        {view === "graph" && (
          <button type="button" onClick={fit} className="rounded text-[#3157D5] underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-[#3157D5]">
            {localized(locale, "适配全图", "Fit graph")}
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
  presentation?: GraphPresentation;
  locale?: UiLocale;
}

export function GraphListView({
  nodes,
  edges,
  selectedId,
  onNodeSelect,
  onEdgeSelect,
  presentation = "domain",
  locale = "zh-CN",
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
    <div className="max-h-[640px] min-h-[440px] overflow-auto px-3 pb-16 pt-16 sm:px-4" onKeyDown={onKeyDown} aria-label={localized(locale, "知识图谱列表，可用方向键选择，Enter 打开详情，Escape 退出焦点", "Knowledge graph list. Use arrow keys to select, Enter for details and Escape to leave.")}>
      <section aria-labelledby="graph-node-list-heading">
        <h2 id="graph-node-list-heading" className="mb-2 text-xs font-semibold tracking-wide text-slate-500">
          {presentation === "learner"
            ? localized(locale, "学习内容", "Learning content")
            : localized(locale, "节点", "Nodes")}
          {localized(locale, `（${nodes.length}）`, ` (${nodes.length})`)}
        </h2>
        {nodes.length ? (
          <ul
            className="grid gap-2 md:grid-cols-2"
            role="listbox"
            aria-label={localized(locale, "图谱节点", "Graph nodes")}
          >
            {nodes.map((node, index) => (
              <li key={node.id} role="presentation">
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
                    <span className="block text-[11px] text-slate-500">
                      {presentation === "learner"
                        ? learnerNodeSubtitle(node, locale)
                        : domainNodeTypeLabel(graphNodeType(node), locale)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            {presentation === "learner"
              ? localized(locale, "当前筛选条件下没有匹配的学习内容。", "No learning content matches these filters.")
              : localized(locale, "当前筛选条件下没有节点。", "No nodes match these filters.")}
          </p>
        )}
      </section>

      <section className="mt-6" aria-labelledby="graph-edge-list-heading">
        <h2 id="graph-edge-list-heading" className="mb-2 text-xs font-semibold tracking-wide text-slate-500">
          {presentation === "learner"
            ? localized(locale, "学习关系", "Learning links")
            : localized(locale, "有向关系", "Directed links")}
          {localized(locale, `（${edges.length}）`, ` (${edges.length})`)}
        </h2>
        {edges.length ? (
          <ul
            className="space-y-2"
            role="listbox"
            aria-label={localized(locale, "图谱关系", "Graph links")}
          >
            {edges.map((edge, edgeIndex) => {
              const index = nodes.length + edgeIndex;
              return (
                <li key={edge.id} role="presentation">
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
                    <span className="truncate text-right">
                      {nodeLabels.get(edge.source) ??
                        (presentation === "learner"
                          ? localized(locale, "学习记录", "Learning record")
                          : edge.source)}
                    </span>
                    <span className="flex min-w-0 max-w-32 flex-col items-center text-[#3157D5] sm:max-w-48">
                      <span
                        className="w-full truncate text-center font-medium"
                        title={edgeDisplayLabel(edge, presentation, locale)}
                      >
                        {edgeDisplayLabel(edge, presentation, locale)}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="truncate">
                      {nodeLabels.get(edge.target) ??
                        (presentation === "learner"
                          ? localized(locale, "学习记录", "Learning record")
                          : edge.target)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            {presentation === "learner"
              ? localized(locale, "当前筛选条件下没有匹配的学习关系。", "No learning links match these filters.")
              : localized(locale, "当前筛选条件下没有关系。", "No links match these filters.")}
          </p>
        )}
      </section>
    </div>
  );
}
