import { describe, expect, it } from "vitest";
import { rawGraphToCytoscape } from "./graph";

describe("rawGraphToCytoscape", () => {
  it("uses assertion ids as edge identities", () => {
    const graph = rawGraphToCytoscape({
      nodes: [
        { id: "node-a", entity_type: "KnowledgePoint", display_name: "A" },
        { id: "node-b", entity_type: "KnowledgePoint", display_name: "B" },
      ],
      assertions: [
        {
          id: "assertion-42",
          subject_id: "node-a",
          object_id: "node-b",
          predicate: "REQUIRES",
        },
      ],
      revision_id: "revision-1",
    });
    expect(graph.elements.edges[0]?.data).toMatchObject({
      id: "assertion-42",
      assertion_id: "assertion-42",
      source: "node-a",
      target: "node-b",
      relation_type: "REQUIRES",
    });
  });

  it("drops edges whose endpoints are absent", () => {
    const graph = rawGraphToCytoscape({
      nodes: [{ id: "node-a" }],
      assertions: [
        { id: "assertion-1", subject_id: "node-a", object_id: "missing" },
      ],
    });
    expect(graph.elements.edges).toHaveLength(0);
  });

  it("derives labels from nested properties", () => {
    const graph = rawGraphToCytoscape({
      nodes: [{ id: "node-a", properties: { canonical_name: "Canonical A" } }],
    });
    expect(graph.elements.nodes[0]?.data.label).toBe("Canonical A");
  });
});
