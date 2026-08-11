import { describe, expect, it } from "vitest";
import type { CytoscapeGraph } from "@/types/api";
import { domainGraphForProduct } from "./DomainGraphPage";

const graph: CytoscapeGraph = {
  elements: {
    nodes: [
      { data: { id: "knowledge", type: "KnowledgePoint", label: "RAG" } },
      { data: { id: "span", type: "SourceSpan", label: "internal-span" } },
      { data: { id: "schema", type: "EntityType", label: "KnowledgePoint" } },
    ],
    edges: [
      {
        data: {
          id: "technical-edge",
          assertion_id: "technical-edge",
          source: "knowledge",
          target: "span",
          relation_type: "SUPPORTED_BY",
        },
      },
    ],
  },
  meta: { revision_id: "revision-1" },
};

describe("domainGraphForProduct", () => {
  it("hides provenance and schema nodes from the default product view", () => {
    const productGraph = domainGraphForProduct(graph);

    expect(productGraph.elements.nodes.map((node) => node.data.id)).toEqual([
      "knowledge",
    ]);
    expect(productGraph.elements.edges).toEqual([]);
    expect(productGraph.meta).toEqual(graph.meta);
  });

  it("keeps the full graph available through the technical-node control", () => {
    expect(domainGraphForProduct(graph, true)).toBe(graph);
  });
});
