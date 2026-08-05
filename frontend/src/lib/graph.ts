import type {
  CytoscapeGraph,
  GraphEdgeData,
  GraphNodeData,
  JsonObject,
} from "@/types/api";

export interface RawGraphData {
  nodes?: JsonObject[];
  assertions?: JsonObject[];
  workspace_id?: string;
  revision_id?: string | null;
}

export function rawGraphToCytoscape(
  raw: RawGraphData,
  meta: JsonObject = {},
): CytoscapeGraph {
  const nodes = (raw.nodes ?? []).flatMap((node) => {
    const id = typeof node.id === "string" ? node.id : null;
    if (!id) return [];
    const properties =
      typeof node.properties === "object" &&
      node.properties !== null &&
      !Array.isArray(node.properties)
        ? node.properties
        : undefined;
    const label =
      typeof node.label === "string"
        ? node.label
        : typeof node.display_name === "string"
          ? node.display_name
          : typeof properties?.display_name === "string"
            ? properties.display_name
            : typeof properties?.canonical_name === "string"
              ? properties.canonical_name
              : typeof properties?.name === "string"
                ? properties.name
                : id;
    return [
      {
        data: {
          ...node,
          id,
          type:
            typeof node.type === "string"
              ? node.type
              : typeof node.entity_type === "string"
                ? node.entity_type
                : "KnowledgePoint",
          label,
          properties,
        } as GraphNodeData,
      },
    ];
  });
  const nodeIds = new Set(nodes.map((node) => node.data.id));
  const edges = (raw.assertions ?? []).flatMap((assertion) => {
    const id =
      typeof assertion.id === "string"
        ? assertion.id
        : typeof assertion.assertion_id === "string"
          ? assertion.assertion_id
          : null;
    const source =
      typeof assertion.subject_id === "string"
        ? assertion.subject_id
        : typeof assertion.source === "string"
          ? assertion.source
          : null;
    const target =
      typeof assertion.object_id === "string"
        ? assertion.object_id
        : typeof assertion.target === "string"
          ? assertion.target
          : null;
    if (
      !id ||
      !source ||
      !target ||
      !nodeIds.has(source) ||
      !nodeIds.has(target)
    )
      return [];
    return [
      {
        data: {
          ...assertion,
          id,
          assertion_id: id,
          source,
          target,
          relation_type:
            typeof assertion.predicate === "string"
              ? assertion.predicate
              : typeof assertion.relation_type === "string"
                ? assertion.relation_type
                : "RELATED",
        } as GraphEdgeData,
      },
    ];
  });
  return {
    elements: { nodes, edges },
    meta: { ...meta, revision_id: raw.revision_id ?? meta.revision_id ?? null },
  };
}

export function graphNodeLabel(node: GraphNodeData): string {
  if (typeof node.label === "string" && node.label) return node.label;
  if (typeof node.properties?.display_name === "string")
    return node.properties.display_name;
  if (typeof node.properties?.canonical_name === "string")
    return node.properties.canonical_name;
  return node.id;
}

export function graphNodeType(node: GraphNodeData): string {
  return node.type || node.entity_type || "Unknown";
}
