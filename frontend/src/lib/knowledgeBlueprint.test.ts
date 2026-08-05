import { describe, expect, it } from "vitest";
import { adaptKnowledgeBlueprint } from "./knowledgeBlueprint";

describe("adaptKnowledgeBlueprint", () => {
  it("adapts the real Pydantic and mock-provider shape deterministically", () => {
    const blueprint = adaptKnowledgeBlueprint({
      title: "Extracted source concept",
      domain: null,
      theories: [
        {
          candidate_key: "theory-1",
          name: "Learning theory",
          description: "A source-grounded theory.",
          source_span_ids: ["span-theory"],
          confidence: 0.8,
        },
      ],
      knowledge_points: [
        {
          candidate_key: "prerequisite",
          canonical_name: "prerequisite idea",
          plain_definition: "A first idea.",
          formal_definition: "P(x).",
          source_span_ids: ["span-prerequisite"],
          six_level_plan: [],
        },
        {
          candidate_key: "source-concept",
          canonical_name: "source concept",
          plain_definition: "The central idea stated by the supplied source.",
          formal_definition: "A source-grounded atomic teaching objective.",
          prerequisites: ["prerequisite"],
          source_span_ids: ["span-point"],
          six_level_plan: [
            {
              cognitive_level: 1,
              learning_objective: "Recognize the source concept.",
              teaching_strategy: "Use a concrete contrast.",
              diagnostic_question: "What is the central idea?",
            },
          ],
          future_extension: { safe: true },
        },
      ],
      examples: [
        {
          candidate_key: "example-1",
          knowledge_point_candidate_id: "source-concept",
          content: "A grounded example.",
          source_span_ids: ["span-example"],
        },
      ],
      counterexamples: [],
      misconceptions: [],
      questions: [
        {
          candidate_key: "question-1",
          knowledge_point_candidate_id: "source-concept",
          cognitive_level: 1,
          question: "Describe it in everyday words.",
          success_criteria: ["states the central idea"],
          source_span_ids: ["span-question"],
        },
      ],
      unresolved_ambiguities: [
        {
          description: "Two terms may be aliases.",
          candidate_keys: ["source-concept"],
        },
      ],
    });

    expect(blueprint).not.toBeNull();
    const point = blueprint!.knowledgePoints.find(
      (item) => item.candidateKey === "source-concept",
    );
    if (!point) throw new Error("source-concept was not adapted");
    expect(point.plainDefinition).toContain("central idea");
    expect(point.prerequisites).toEqual([
      { key: "prerequisite", name: "prerequisite idea" },
    ]);
    expect(point.methods).toEqual(["Use a concrete contrast."]);
    expect(point.examples.at(0)?.content).toBe("A grounded example.");
    expect(point.assessments.at(0)?.question).toContain("everyday words");
    expect(point.graphNodeId).toBeNull();
    expect(point.graphLinkReason).toContain("候选键");
    expect(blueprint!.sourceSpanIds).toEqual(
      expect.arrayContaining(["span-point", "span-example", "span-question"]),
    );
    expect(blueprint!.ambiguities.at(0)?.description).toContain("aliases");
  });

  it("only accepts an explicit valid graph node UUID for graph navigation", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const blueprint = adaptKnowledgeBlueprint({
      title: "IDs",
      knowledge_points: [
        { candidate_key: id, canonical_name: "candidate only" },
        {
          candidate_key: "bad-explicit",
          canonical_name: "bad explicit id",
          graph_node_id: "not-a-uuid",
        },
        {
          candidate_key: "linked",
          canonical_name: "linked point",
          graph_node_id: id,
        },
      ],
    });

    expect(blueprint!.knowledgePoints.at(0)?.graphNodeId).toBeNull();
    expect(blueprint!.knowledgePoints.at(1)?.graphLinkReason).toContain(
      "不是有效 UUID",
    );
    expect(blueprint!.knowledgePoints.at(2)?.graphNodeId).toBe(id);
  });

  it("tolerates absent arrays and rejects non-object payloads", () => {
    expect(adaptKnowledgeBlueprint("not-an-object")).toBeNull();
    expect(
      adaptKnowledgeBlueprint({ title: 42, knowledge_points: "future-shape" }),
    ).toMatchObject({
      title: "未命名 Knowledge Blueprint",
      knowledgePoints: [],
      theories: [],
    });
  });
});
