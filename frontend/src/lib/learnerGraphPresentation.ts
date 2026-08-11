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
  return {
    relation_type: type,
    display_label: learnerGraphRelationLabel(type, locale),
    display_description: relationExplanation(edge, labels, locale),
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

function groupLearnerRelationships(
  edges: Array<{ data: GraphEdgeData }>,
  labels: Map<string, string>,
  locale: UiLocale,
): Array<{ data: GraphEdgeData }> {
  const groups = new Map<string, GraphEdgeData[]>();
  for (const { data } of edges) {
    const pair = [data.source, data.target].sort();
    const key = `${pair[0]}\u0000${pair[1]}`;
    const current = groups.get(key);
    if (current) current.push(data);
    else groups.set(key, [data]);
  }

  return Array.from(groups.values()).map((relationships) => {
    const primary = relationships[0]!;
    const types = Array.from(new Set(relationships.map(relationType).filter(Boolean)));
    const directions = new Set(
      relationships.map((edge) => `${edge.source}\u0000${edge.target}`),
    );
    const attentionTargetIds = Array.from(
      new Set(
        relationships
          .filter((edge) =>
            learnerGraphEdgeRelationTypes(edge).some((type) =>
              attentionRelations.has(type),
            ),
          )
          .map((edge) => edge.target),
      ),
    );
    const summaries = relationships.map((edge) =>
      relationshipSummary(edge, labels, locale),
    );
    const sourceLabel =
      labels.get(primary.source) ?? pick(locale, "学习内容", "Learning content");
    const targetLabel =
      labels.get(primary.target) ?? pick(locale, "学习内容", "Learning content");
    const displayLabel =
      relationships.length === 1
        ? learnerGraphRelationLabel(types[0] ?? "", locale)
        : pick(
            locale,
            `${relationships.length} 条学习关系`,
            `${relationships.length} learning links`,
          );
    const displayDescription =
      relationships.length === 1
        ? relationExplanation(primary, labels, locale)
        : pick(
            locale,
            `${sourceLabel} 与 ${targetLabel} 之间包含 ${relationships.length} 条学习关系。`,
            `${sourceLabel} and ${targetLabel} have ${relationships.length} learning links.`,
          );

    return {
      data: {
        ...primary,
        display_label: displayLabel,
        display_description: displayDescription,
        source_label: sourceLabel,
        target_label: targetLabel,
        relation_types: types,
        relationship_count: relationships.length,
        relationship_summaries: summaries,
        mixed_direction: directions.size > 1,
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
      edges: groupLearnerRelationships(edges, labels, locale),
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
