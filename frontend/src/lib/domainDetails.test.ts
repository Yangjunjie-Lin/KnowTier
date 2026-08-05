import { describe, expect, it } from "vitest";
import {
  adaptDomainAssertionDetail,
  adaptDomainNodeDetail,
  epistemicStatusLabel,
  relationTypeLabel,
} from "./domainDetails";

describe("domain detail adapters", () => {
  it("adapts the in-memory node-detail contract with nested properties", () => {
    const detail = adaptDomainNodeDetail({
      node: {
        id: "11111111-1111-4111-8111-111111111111",
        node_type: "KnowledgePoint",
        properties: {
          canonical_name: "bayesian updating",
          plain_language_definition: "Revise a belief using evidence.",
          formal_definition: "P(H|E) ∝ P(E|H)P(H)",
          knowledge_domain: "概率论",
        },
        epistemic_status: "CONFIRMED",
        source_confidence: 0.9,
      },
      theories: [
        {
          id: "theory-id",
          node_type: "Theory",
          properties: { display_name: "Bayesian theory" },
        },
      ],
      prerequisites: [
        {
          id: "prerequisite-id",
          node_type: "KnowledgePoint",
          properties: { canonical_name: "conditional probability" },
        },
      ],
      related_knowledge_points: [],
      incoming_assertions: [
        {
          id: "incoming-id",
          subject_id: "subject-id",
          predicate: "ENABLES",
          object_id: "11111111-1111-4111-8111-111111111111",
          description: "Conditional probability enables Bayesian updating.",
          active: true,
        },
      ],
      outgoing_assertions: [
        {
          assertion: {
            id: "outgoing-id",
            predicate_key: "REQUIRES",
            natural_language_description:
              "Bayesian updating requires conditional probability.",
          },
          object: {
            id: "prerequisite-id",
            entity_type: "KnowledgePoint",
            display_name: "Conditional probability",
          },
        },
      ],
      learning_stages: [
        {
          id: "stage-id",
          node_type: "LearningStage",
          properties: {
            cognitive_level: 1,
            learning_objective: "Recognize an update.",
            teaching_strategy: "Use a frequency example.",
          },
        },
      ],
      sources: [
        {
          id: "span-id",
          page_number: 3,
          text: "Source excerpt",
          source_document: {
            properties: { original_filename: "bayes.txt" },
          },
        },
      ],
      graph_revision: "revision-id",
      future_extension: { ignored: true },
    });

    expect(detail).not.toBeNull();
    expect(detail!.node.name).toBe("bayesian updating");
    expect(detail!.plainDefinition).toContain("Revise a belief");
    expect(detail!.formalDefinition).toContain("P(H|E)");
    expect(detail!.domain).toBe("概率论");
    expect(detail!.prerequisites.at(0)?.name).toBe("conditional probability");
    expect(detail!.outgoing.at(0)?.endpoint?.name).toBe(
      "Conditional probability",
    );
    expect(detail!.incoming.at(0)?.endpointId).toBe("subject-id");
    expect(detail!.learningStages.at(0)?.level).toBe(1);
    expect(detail!.sources.at(0)).toMatchObject({
      documentName: "bayes.txt",
      page: 3,
    });
    expect(detail!.graphRevision).toBe("revision-id");
  });

  it("adapts Neo4j assertion history without reversing supersession", () => {
    const detail = adaptDomainAssertionDetail({
      assertion: {
        id: "assertion-id",
        subject_id: "subject-id",
        object_id: "object-id",
        predicate_key: "REQUIRES",
        natural_language_description: "Calculus requires limits.",
        confidence: 0.87,
        epistemic_status: "PROPOSED",
        valid_from: "2026-08-05T00:00:00Z",
      },
      subject: {
        id: "subject-id",
        entity_type: "KnowledgePoint",
        display_name: "Calculus",
      },
      object: {
        id: "object-id",
        entity_type: "KnowledgePoint",
        display_name: "Limits",
      },
      replacements: [
        {
          id: "new-id",
          natural_language_description: "A newer assertion replaces this one.",
        },
      ],
      superseded_assertions: [
        {
          id: "old-id",
          natural_language_description: "This assertion replaced the old one.",
        },
      ],
      conflicts: [{ id: "conflict-id", description: "Competing object" }],
      revision_id: "revision-id",
    });

    expect(detail).not.toBeNull();
    expect(detail!.subject.name).toBe("Calculus");
    expect(detail!.object.name).toBe("Limits");
    expect(detail!.relationTypeLabel).toBe("需要先掌握");
    expect(detail!.supersedes.at(0)?.id).toBe("old-id");
    expect(detail!.supersededBy.at(0)?.id).toBe("new-id");
    expect(detail!.conflicts.at(0)?.description).toBe("Competing object");
  });

  it("uses readable fallbacks for unknown enum extensions", () => {
    expect(relationTypeLabel("FUTURE_RELATION")).toBe("Future Relation");
    expect(epistemicStatusLabel("FUTURE_STATUS")).toBe("Future Status");
    expect(adaptDomainNodeDetail(null)).toBeNull();
    expect(adaptDomainAssertionDetail(["invalid"])).toBeNull();
  });
});
