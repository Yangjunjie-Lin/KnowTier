import { Maximize2, Minimize2, Minus, Plus, Scan } from "lucide-react";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { useEffect, useRef, useState } from "react";
import { graphNodeLabel, graphNodeType } from "@/lib/graph";
import { cn, displayPercent } from "@/lib/utils";
import type { CytoscapeGraph, GraphEdgeData, GraphNodeData } from "@/types/api";

interface GraphCanvasProps {
  graph: CytoscapeGraph;
  selectedId?: string | null;
  search?: string;
  nodeTypes?: string[];
  relationTypes?: string[];
  density?: "comfortable" | "compact" | "dense";
  onNodeSelect?: (node: GraphNodeData) => void;
  onEdgeSelect?: (edge: GraphEdgeData) => void;
  className?: string;
}

const nodeColors: Record<string, string> = {
  Domain: "#1E3A9E",
  Theory: "#3157D5",
  KnowledgePoint: "#5577E8",
  Definition: "#7B96EF",
  Method: "#4264C8",
  Learner: "#16A34A",
  LearnerKnowledgeState: "#0F8A5F",
  LearnerGraphResource: "#64748B",
};

export function GraphCanvas({
  graph,
  selectedId,
  search = "",
  nodeTypes,
  relationTypes,
  density = "comfortable",
  onNodeSelect,
  onEdgeSelect,
  className,
}: GraphCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const visibleNodes = graph.elements.nodes.filter((node) => {
      const typeOk =
        !nodeTypes?.length || nodeTypes.includes(graphNodeType(node.data));
      const query = search.trim().toLowerCase();
      const textOk =
        !query ||
        graphNodeLabel(node.data).toLowerCase().includes(query) ||
        node.data.id.toLowerCase().includes(query);
      return typeOk && textOk;
    });
    const visibleIds = new Set(visibleNodes.map((node) => node.data.id));
    const visibleEdges = graph.elements.edges.filter(
      (edge) =>
        visibleIds.has(edge.data.source) &&
        visibleIds.has(edge.data.target) &&
        (!relationTypes?.length ||
          relationTypes.includes(
            edge.data.relation_type ?? edge.data.predicate ?? "",
          )),
    );
    const elements: ElementDefinition[] = [...visibleNodes, ...visibleEdges];
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
            label: "data(label)",
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
            "border-color": "#fff",
            "overlay-opacity": 0,
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.2,
            "line-color": "#A9B7D9",
            "target-arrow-color": "#A9B7D9",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(relation_type)",
            color: "#64748B",
            "font-size": "8px",
            "text-background-color": "#fff",
            "text-background-opacity": 0.85,
            "text-background-padding": "2px",
            opacity: 0.75,
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
        name: visibleNodes.length > 80 ? "grid" : "cose",
        animate: false,
        fit: true,
        padding: 36,
      },
    });
    cyRef.current = cy;
    cy.on("tap", "node", (event) => {
      const target = event.target as cytoscape.NodeSingular;
      onNodeSelect?.(target.data() as GraphNodeData);
    });
    cy.on("tap", "edge", (event) => {
      const target = event.target as cytoscape.EdgeSingular;
      onEdgeSelect?.(target.data() as GraphEdgeData);
    });
    cy.on("zoom", () => setZoom(cy.zoom()));
    if (selectedId) cy.$id(selectedId).select();
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [
    density,
    graph,
    nodeTypes,
    onEdgeSelect,
    onNodeSelect,
    relationTypes,
    search,
    selectedId,
  ]);

  const adjustZoom = (delta: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({
      level: Math.max(0.15, Math.min(4, cy.zoom() + delta)),
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  };
  const fit = () => cyRef.current?.fit(undefined, 36);
  return (
    <div
      className={cn(
        "relative min-h-[420px] overflow-hidden rounded-xl border border-slate-200 bg-[#F8FAFF] dark:border-slate-700 dark:bg-slate-900",
        fullScreen &&
          "fixed inset-3 z-50 min-h-0 bg-white shadow-2xl dark:bg-slate-950",
        className,
      )}
    >
      <div
        ref={hostRef}
        className="h-full min-h-[420px] w-full"
        role="application"
        aria-label="知识图谱，可使用鼠标或键盘聚焦节点"
      />
      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900/95">
        <button
          type="button"
          onClick={() => adjustZoom(0.25)}
          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#3157D5]"
          aria-label="放大"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => adjustZoom(-0.25)}
          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#3157D5]"
          aria-label="缩小"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={fit}
          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#3157D5]"
          aria-label="适配视图"
        >
          <Scan className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setFullScreen((value) => !value)}
          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#3157D5]"
          aria-label={fullScreen ? "退出全屏" : "全屏"}
        >
          {fullScreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </button>
      </div>
      <div className="absolute bottom-3 left-3 rounded bg-white/85 px-2 py-1 font-mono text-[10px] text-slate-500 dark:bg-slate-900/85">
        {graph.elements.nodes.length} 节点 · {graph.elements.edges.length} 关系
        · {displayPercent(Math.min(1, zoom / 4))} 缩放
      </div>
    </div>
  );
}
