import { graphNodeLabel, graphNodeType } from "./graph";
import type {
  CytoscapeGraph,
  GraphEdgeData,
  GraphNodeData,
  JsonObject,
} from "@/types/api";
import type { UiLocale } from "@/types/app";

const relationLabels: Record<string, readonly [string, string]> = {
  HAS_KNOWLEDGE_STATE: ["掌握状态", "Mastery status"],
  HAS_MASTERY_EVIDENCE: ["掌握证据", "Mastery evidence"],
  HAS_MISCONCEPTION: ["待纠正理解", "Needs correction"],
  REQUIRES_REVIEW: ["需要复习", "Review needed"],
  BLOCKED_BY_PREREQUISITE: ["受前置知识影响", "Prerequisite gap"],
  READY_FOR_PROMOTION: ["可以进阶", "Ready to advance"],
  LEARNING_GOAL: ["当前目标", "Current goal"],
  RECENTLY_PRACTICED: ["最近练习", "Recently practised"],
  NEEDS_TRANSFER_EVIDENCE: ["需要更多练习", "More practice needed"],
  USER_SUPPLIED: ["自主学习主题", "Learner topic"],
};

export type LearnerOntologyEntityType =
  | "learner"
  | "knowledge_state"
  | "mastery_evidence"
  | "learning_record"
  | "learning_content";

export type LearnerOntologyRelationType =
  | "learner_knowledge_profile"
  | "knowledge_dependency"
  | "learning_evidence_link"
  | "learning_record_link"
  | "learning_association";

export type LearnerRelationFacet =
  | "mastery"
  | "goal"
  | "activity"
  | "evidence"
  | "risk"
  | "readiness"
  | "provenance"
  | "association";

interface LearnerNodeOntology {
  entityType: LearnerOntologyEntityType;
  label: string;
  description: string;
  role: "identity" | "knowledge" | "evidence" | "context";
}

interface LearnerRelationshipOntology {
  relationType: LearnerOntologyRelationType;
  label: string;
  description: string;
}

const relationFacets: Record<string, LearnerRelationFacet> = {
  HAS_KNOWLEDGE_STATE: "mastery",
  HAS_MASTERY_EVIDENCE: "evidence",
  HAS_MISCONCEPTION: "risk",
  REQUIRES_REVIEW: "risk",
  BLOCKED_BY_PREREQUISITE: "risk",
  READY_FOR_PROMOTION: "readiness",
  LEARNING_GOAL: "goal",
  RECENTLY_PRACTICED: "activity",
  NEEDS_TRANSFER_EVIDENCE: "evidence",
  USER_SUPPLIED: "provenance",
};

const relationFacetLabels: Record<
  LearnerRelationFacet,
  readonly [string, string]
> = {
  mastery: ["掌握", "Mastery"],
  goal: ["目标", "Goal"],
  activity: ["练习", "Practice"],
  evidence: ["证据", "Evidence"],
  risk: ["待关注", "Attention"],
  readiness: ["进阶", "Readiness"],
  provenance: ["来源", "Provenance"],
  association: ["关联", "Association"],
};

const attentionRelations = new Set([
  "HAS_MISCONCEPTION",
  "REQUIRES_REVIEW",
  "BLOCKED_BY_PREREQUISITE",
  "NEEDS_TRANSFER_EVIDENCE",
]);

function relationType(edge: GraphEdgeData): string {
  return edge.relation_type ?? edge.predicate ?? "";
}

export function learnerGraphEdgeRelationTypes(edge: GraphEdgeData): string[] {
  const groupedTypes = Array.isArray(edge.relation_types)
    ? edge.relation_types.filter(
        (value): value is string => typeof value === "string" && Boolean(value),
      )
    : [];
  if (groupedTypes.length > 0) return Array.from(new Set(groupedTypes));
  const singleType = relationType(edge);
  return singleType ? [singleType] : [];
}

function isIdentifier(value: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) ||
    /^[0-9a-f]{24,}$/i.test(value)
  );
}

function safeOriginalLabel(node: GraphNodeData): string | null {
  const label = graphNodeLabel(node).trim();
  return !label || label === node.id || isIdentifier(label) ? null : label;
}

function pick(locale: UiLocale, chinese: string, english: string): string {
  return locale === "en" ? english : chinese;
}

function relationFacet(type: string): LearnerRelationFacet {
  return relationFacets[type] ?? "association";
}

function relationFacetLabel(
  facet: LearnerRelationFacet,
  locale: UiLocale,
): string {
  const label = relationFacetLabels[facet];
  return pick(locale, label[0], label[1]);
}

export function learnerGraphNodeOntology(
  type: string,
  locale: UiLocale = "zh-CN",
): LearnerNodeOntology {
  if (type === "Learner") {
    return {
      entityType: "learner",
      label: pick(locale, "学习者", "Learner"),
      description: pick(
        locale,
        "学习身份实体，是个人目标、练习与掌握状态的汇聚中心。",
        "The learning identity that anchors personal goals, practice and mastery states.",
      ),
      role: "identity",
    };
  }
  if (type === "LearnerKnowledgeState") {
    return {
      entityType: "knowledge_state",
      label: pick(locale, "知识状态", "Knowledge state"),
      description: pick(
        locale,
        "学习者对一个知识点的当前掌握模型，包含掌握度与评估状态。",
        "The learner's current model of one knowledge point, including mastery and assessment state.",
      ),
      role: "knowledge",
    };
  }
  if (type === "MasteryEvidence") {
    return {
      entityType: "mastery_evidence",
      label: pick(locale, "掌握证据", "Mastery evidence"),
      description: pick(
        locale,
        "支持掌握判断的学习回答、评分或可追溯证据。",
        "A learning response, score or traceable record supporting a mastery judgement.",
      ),
      role: "evidence",
    };
  }
  if (type === "LearnerGraphResource" || type === "LearnerResource") {
    return {
      entityType: "learning_record",
      label: pick(locale, "学习记录", "Learning record"),
      description: pick(
        locale,
        "与本次学习过程相关的证据、回答或活动记录。",
        "Evidence, responses or activity records related to the learning process.",
      ),
      role: "context",
    };
  }
  return {
    entityType: "learning_content",
    label: pick(locale, "学习内容", "Learning content"),
    description: pick(
      locale,
      "参与当前学习关系的内容实体。",
      "A content entity participating in the current learning relationship.",
    ),
    role: "context",
  };
}

export function learnerGraphRelationLabel(
  value: string,
  locale: UiLocale = "zh-CN",
): string {
  const label = relationLabels[value];
  return label ? pick(locale, label[0], label[1]) : pick(locale, "学习关联", "Learning link");
}

export function learnerGraphNodeTypeLabel(
  type: string,
  locale: UiLocale = "zh-CN",
): string {
  if (type === "Learner") return pick(locale, "学习者", "Learner");
  if (type === "LearnerKnowledgeState") return pick(locale, "知识点", "Knowledge point");
  if (type === "LearnerGraphResource" || type === "LearnerResource")
    return pick(locale, "学习记录", "Learning record");
  if (type === "MasteryEvidence") return pick(locale, "掌握证据", "Mastery evidence");
  return pick(locale, "学习内容", "Learning content");
}

function resourceKind(
  nodeId: string,
  edges: Array<{ data: GraphEdgeData }>,
  locale: UiLocale,
): string {
  const incidentTypes = edges
    .filter(
      ({ data }) => data.source === nodeId || data.target === nodeId,
    )
    .map(({ data }) => relationType(data));
  if (incidentTypes.includes("HAS_MASTERY_EVIDENCE"))
    return pick(locale, "掌握证据", "Mastery evidence");
  if (incidentTypes.includes("HAS_MISCONCEPTION"))
    return pick(locale, "待纠正理解", "Needs correction");
  return pick(locale, "学习记录", "Learning record");
}

function learnerStatus(score: unknown, locale: UiLocale): string {
  if (typeof score !== "number" || !Number.isFinite(score))
    return pick(locale, "待评估", "Not assessed");
  if (score >= 0.8) return pick(locale, "已掌握", "Mastered");
  if (score >= 0.5) return pick(locale, "学习中", "In progress");
  return pick(locale, "需加强", "Needs practice");
}

function relationExplanation(
  edge: GraphEdgeData,
  labels: Map<string, string>,
  locale: UiLocale,
): string {
  const type = relationType(edge);
  const target = labels.get(edge.target) ?? pick(locale, "这个知识点", "this knowledge point");
  switch (type) {
    case "HAS_KNOWLEDGE_STATE":
      return pick(locale, `${target} 的当前掌握状态`, `Current mastery of ${target}`);
    case "HAS_MASTERY_EVIDENCE":
      return pick(locale, "学习回答形成了这条掌握证据", "A learning response produced this mastery evidence");
    case "HAS_MISCONCEPTION": {
      const detail = edge.natural_language_description?.trim();
      return detail
        ? pick(locale, `待纠正：${detail}`, `Needs correction: ${detail}`)
        : pick(locale, `${target} 存在待纠正的理解`, `${target} includes an understanding to correct`);
    }
    case "REQUIRES_REVIEW":
      return pick(locale, `${target} 需要安排复习`, `${target} should be reviewed`);
    case "BLOCKED_BY_PREREQUISITE":
      return pick(locale, `先理解 ${target}，再继续当前目标`, `Understand ${target} before continuing the current goal`);
    case "READY_FOR_PROMOTION":
      return pick(locale, `${target} 已具备进阶条件`, `${target} is ready for the next level`);
    case "LEARNING_GOAL":
      return pick(locale, `${target} 是当前学习目标`, `${target} is the current learning goal`);
    case "RECENTLY_PRACTICED":
      return pick(locale, `最近练习了 ${target}`, `${target} was practised recently`);
    case "NEEDS_TRANSFER_EVIDENCE":
      return pick(locale, `${target} 还需要独立应用练习`, `${target} needs independent application practice`);
    case "USER_SUPPLIED":
      return pick(locale, `${target} 来自学习者主动提出的主题`, `${target} was introduced by the learner`);
    default:
      return pick(locale, "这条关系来自已保存的学习记录", "This link comes from a saved learning record");
  }
}

function relationshipSummary(
  edge: GraphEdgeData,
  labels: Map<string, string>,
  locale: UiLocale,
): JsonObject {
  const type = relationType(edge);
  const facet = relationFacet(type);
  return {
    relation_type: type,
    display_label: learnerGraphRelationLabel(type, locale),
    display_description: relationExplanation(edge, labels, locale),
    relation_facet: facet,
    relation_facet_label: relationFacetLabel(facet, locale),
    source_id: edge.source,
    target_id: edge.target,
    source_label: labels.get(edge.source) ?? pick(locale, "学习内容", "Learning content"),
    target_label: labels.get(edge.target) ?? pick(locale, "学习内容", "Learning content"),
    confidence:
      typeof edge.confidence === "number" && Number.isFinite(edge.confidence)
        ? edge.confidence
        : null,
    valid_from: typeof edge.valid_from === "string" ? edge.valid_from : null,
    valid_to: typeof edge.valid_to === "string" ? edge.valid_to : null,
    is_active: edge.active !== false && edge.is_active !== false && !edge.valid_to,
  };
}

function jsonObjectArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is JsonObject =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

function relationshipOntology(
  source: GraphNodeData | undefined,
  target: GraphNodeData | undefined,
  locale: UiLocale,
): LearnerRelationshipOntology {
  const entityTypes = new Set(
    [source, target]
      .filter((node): node is GraphNodeData => Boolean(node))
      .map((node) => {
        const presentedType = node.ontology_entity_type;
        return typeof presentedType === "string"
          ? presentedType
          : learnerGraphNodeOntology(graphNodeType(node), locale).entityType;
      }),
  );
  if (entityTypes.has("learner") && entityTypes.has("knowledge_state")) {
    return {
      relationType: "learner_knowledge_profile",
      label: pick(locale, "学习进展关系", "Learning progress relationship"),
      description: pick(
        locale,
        "汇总学习者与该知识点之间的目标、练习、掌握和待关注事实。",
        "Groups goals, practice, mastery and attention facts between the learner and this knowledge point.",
      ),
    };
  }
  if (entityTypes.size === 1 && entityTypes.has("knowledge_state")) {
    return {
      relationType: "knowledge_dependency",
      label: pick(locale, "知识依赖关系", "Knowledge dependency"),
      description: pick(
        locale,
        "表示两个知识点在当前学习进程中的前置、阻塞或进阶联系。",
        "Represents prerequisite, blocking or progression links between two knowledge points.",
      ),
    };
  }
  if (entityTypes.has("mastery_evidence")) {
    return {
      relationType: "learning_evidence_link",
      label: pick(locale, "学习证据关系", "Learning evidence relationship"),
      description: pick(
        locale,
        "连接学习实体与支持判断的可追溯证据。",
        "Connects a learning entity with traceable evidence supporting a judgement.",
      ),
    };
  }
  if (entityTypes.has("learning_record")) {
    return {
      relationType: "learning_record_link",
      label: pick(locale, "学习记录关系", "Learning record relationship"),
      description: pick(
        locale,
        "连接学习实体与相关回答或活动记录。",
        "Connects a learning entity with a related response or activity record.",
      ),
    };
  }
  return {
    relationType: "learning_association",
    label: pick(locale, "学习关联", "Learning association"),
    description: pick(
      locale,
      "汇总两个学习实体之间当前有效的关系事实。",
      "Groups the currently active relationship facts between two learning entities.",
    ),
  };
}

function relationshipFacts(
  edge: GraphEdgeData,
  labels: Map<string, string>,
  locale: UiLocale,
): JsonObject[] {
  const existing = jsonObjectArray(edge.relationship_summaries);
  return existing.length > 0
    ? existing
    : [relationshipSummary(edge, labels, locale)];
}

function canonicalNodePair(source: string, target: string): [string, string] {
  return source.localeCompare(target) <= 0 ? [source, target] : [target, source];
}

function stableRelationshipId(source: string, target: string): string {
  return `learner-link:${encodeURIComponent(source)}:${encodeURIComponent(target)}`;
}

export function consolidateLearnerGraphRelationships(
  edges: Array<{ data: GraphEdgeData }>,
  nodes: Array<{ data: GraphNodeData }>,
  labels: Map<string, string>,
  locale: UiLocale,
): Array<{ data: GraphEdgeData }> {
  const groups = new Map<string, GraphEdgeData[]>();
  for (const { data } of edges) {
    const pair = canonicalNodePair(data.source, data.target);
    const key = `${pair[0]}\u0000${pair[1]}`;
    const current = groups.get(key);
    if (current) current.push(data);
    else groups.set(key, [data]);
  }

  const nodeMap = new Map(nodes.map(({ data }) => [data.id, data]));

  return Array.from(groups.values()).map((relationships) => {
    const primary = relationships[0]!;
    const pair = canonicalNodePair(primary.source, primary.target);
    const firstNode = nodeMap.get(pair[0]);
    const secondNode = nodeMap.get(pair[1]);
    const firstOntology = firstNode
      ? learnerGraphNodeOntology(graphNodeType(firstNode), locale)
      : null;
    const secondOntology = secondNode
      ? learnerGraphNodeOntology(graphNodeType(secondNode), locale)
      : null;
    const learnerFirst = firstOntology?.entityType === "learner";
    const learnerSecond = secondOntology?.entityType === "learner";
    const source = learnerSecond && !learnerFirst ? pair[1] : pair[0];
    const target = source === pair[0] ? pair[1] : pair[0];
    const facts = relationships.flatMap((edge) =>
      relationshipFacts(edge, labels, locale),
    );
    const types = Array.from(
      new Set(
        relationships.flatMap((edge) => learnerGraphEdgeRelationTypes(edge)),
      ),
    );
    const facets = Array.from(new Set(types.map(relationFacet)));
    const directions = new Set(
      facts.map((fact) => {
        const factSource =
          typeof fact.source_id === "string" ? fact.source_id : primary.source;
        const factTarget =
          typeof fact.target_id === "string" ? fact.target_id : primary.target;
        return `${factSource}\u0000${factTarget}`;
      }),
    );
    const attentionTargetIds = Array.from(
      new Set(
        facts.flatMap((fact) => {
          const type =
            typeof fact.relation_type === "string" ? fact.relation_type : "";
          const targetId =
            typeof fact.target_id === "string" ? fact.target_id : null;
          return attentionRelations.has(type) && targetId ? [targetId] : [];
        }),
      ),
    );
    const ontology = relationshipOntology(
      nodeMap.get(source),
      nodeMap.get(target),
      locale,
    );
    const sourceLabel =
      labels.get(source) ?? pick(locale, "学习内容", "Learning content");
    const targetLabel =
      labels.get(target) ?? pick(locale, "学习内容", "Learning content");
    const visibleFactLabels = Array.from(
      new Set(types.map((type) => learnerGraphRelationLabel(type, locale))),
    );
    const displayLabel =
      visibleFactLabels.length <= 2
        ? visibleFactLabels.join(" · ")
        : `${visibleFactLabels.slice(0, 2).join(" · ")} +${visibleFactLabels.length - 2}`;
    const confidences = facts.flatMap((fact) =>
      typeof fact.confidence === "number" && Number.isFinite(fact.confidence)
        ? [fact.confidence]
        : [],
    );

    return {
      data: {
        ...primary,
        id: stableRelationshipId(pair[0], pair[1]),
        source,
        target,
        display_label: displayLabel || ontology.label,
        display_description: ontology.description,
        source_label: sourceLabel,
        target_label: targetLabel,
        ontology_relation_type: ontology.relationType,
        ontology_relation_label: ontology.label,
        ontology_relation_description: ontology.description,
        relation_types: types,
        relation_facets: facets,
        relation_facet_labels: facets.map((facet) =>
          relationFacetLabel(facet, locale),
        ),
        relationship_count: facts.length,
        relationship_summaries: facts,
        average_confidence:
          confidences.length > 0
            ? confidences.reduce((total, value) => total + value, 0) /
              confidences.length
            : null,
        mixed_direction: directions.size > 1,
        aggregate_relationship: true,
        attention_target_ids: attentionTargetIds,
      },
    };
  });
}

export function buildLearnerGraphPresentation(
  graph: CytoscapeGraph,
  includeHistory = false,
  locale: UiLocale = "zh-CN",
): CytoscapeGraph {
  const edges = graph.elements.edges.filter(({ data }) => {
    if (includeHistory) return true;
    return data.active !== false && data.is_active !== false && !data.valid_to;
  });
  const activeNodeIds = new Set(
    edges.flatMap(({ data }) => [data.source, data.target]),
  );
  const resourceCounters = new Map<string, number>();
  const nodes = graph.elements.nodes
    .filter(({ data }) => {
      const type = graphNodeType(data);
      return (
        type !== "LearnerGraphResource" ||
        activeNodeIds.has(data.id) ||
        includeHistory
      );
    })
    .map(({ data }) => {
      const type = graphNodeType(data);
      const ontology =
        type.includes("Resource") &&
        edges.some(
          ({ data: edge }) =>
            (edge.source === data.id || edge.target === data.id) &&
            relationType(edge) === "HAS_MASTERY_EVIDENCE",
        )
          ? learnerGraphNodeOntology("MasteryEvidence", locale)
          : learnerGraphNodeOntology(type, locale);
      const original = safeOriginalLabel(data);
      let label = original;
      if (!label && type === "Learner") label = pick(locale, "当前学习者", "Current learner");
      if (!label && type === "LearnerKnowledgeState")
        label = pick(locale, "未命名知识点", "Unnamed knowledge point");
      if (!label && type.includes("Resource")) {
        const kind = resourceKind(data.id, edges, locale);
        const count = (resourceCounters.get(kind) ?? 0) + 1;
        resourceCounters.set(kind, count);
        label = count === 1 ? kind : `${kind} ${count}`;
      }
      label ??= pick(locale, "学习内容", "Learning content");
      return {
        data: {
          ...data,
          label,
          display_type: learnerGraphNodeTypeLabel(type, locale),
          ontology_entity_type: ontology.entityType,
          ontology_entity_label: ontology.label,
          ontology_entity_description: ontology.description,
          ontology_role: ontology.role,
          learner_status: learnerStatus(data.mastery_score, locale),
        },
      };
    });
  const labels = new Map(
    nodes.map(({ data }) => [data.id, data.label ?? pick(locale, "学习内容", "Learning content")]),
  );
  return {
    elements: {
      nodes,
      edges: consolidateLearnerGraphRelationships(edges, nodes, labels, locale),
    },
    meta: { ...graph.meta },
  };
}

export interface LearnerGraphSummary {
  knowledgePointCount: number;
  evaluatedCount: number;
  averageMastery: number | null;
  attentionCount: number;
}

export function summarizeLearnerGraph(
  graph: CytoscapeGraph,
): LearnerGraphSummary {
  const knowledgeNodes = graph.elements.nodes.filter(
    ({ data }) => graphNodeType(data) === "LearnerKnowledgeState",
  );
  const scores = knowledgeNodes.flatMap(({ data }) =>
    typeof data.mastery_score === "number" && Number.isFinite(data.mastery_score)
      ? [data.mastery_score]
      : [],
  );
  const attentionNodeIds = new Set(
    graph.elements.edges.flatMap(({ data }) =>
      Array.isArray(data.attention_target_ids)
        ? data.attention_target_ids.filter(
            (value): value is string => typeof value === "string",
          )
        : learnerGraphEdgeRelationTypes(data).some((type) =>
              attentionRelations.has(type),
          )
          ? [data.target]
          : [],
    ),
  );
  return {
    knowledgePointCount: knowledgeNodes.length,
    evaluatedCount: scores.length,
    averageMastery:
      scores.length > 0
        ? scores.reduce((total, score) => total + score, 0) / scores.length
        : null,
    attentionCount: knowledgeNodes.filter(({ data }) =>
      attentionNodeIds.has(data.id),
    ).length,
  };
}

export function learnerGraphRelationTypes(
  graph: CytoscapeGraph,
  locale: UiLocale = "zh-CN",
): string[] {
  return Array.from(
    new Set(
      graph.elements.edges.flatMap(({ data }) => learnerGraphEdgeRelationTypes(data)),
    ),
  ).sort((left, right) =>
    learnerGraphRelationLabel(left, locale).localeCompare(
      learnerGraphRelationLabel(right, locale),
      locale === "en" ? "en" : "zh-CN",
    ),
  );
}
