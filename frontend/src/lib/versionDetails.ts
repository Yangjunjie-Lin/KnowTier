import {
  asRecord,
  firstNumber,
  firstText,
  humanizeUnknown,
  mergedRecord,
  numberValue,
  recordArray,
  textArray,
  textValue,
  uniqueStrings,
  type UnknownRecord,
} from "./dataAdapter";
import { displayPercent } from "./utils";

export interface VersionChangeMetric {
  provided: boolean;
  count: number | null;
  items: string[];
}

export interface DomainVersionDetailModel {
  id: string | null;
  sequenceNumber: number | null;
  status: string | null;
  projectionStatus: string | null;
  parentRevisionId: string | null;
  hasParentField: boolean;
  createdBy: string | null;
  modelRunId: string | null;
  createdAt: string | null;
  projectedAt: string | null;
  nodesAdded: VersionChangeMetric;
  relationsAdded: VersionChangeMetric;
  relationsSuperseded: VersionChangeMetric;
  conflicts: VersionChangeMetric;
  sourceChanges: VersionChangeMetric;
  nodesUpdated: VersionChangeMetric;
  summaryNarrative: string;
  manifestFacts: Array<{ label: string; value: string }>;
  raw: UnknownRecord;
}

export interface LearnerVersionRelation {
  id: string | null;
  predicate: string;
  predicateLabel: string;
  subjectId: string | null;
  objectId: string | null;
  description: string;
  confidence: number | null;
  active: boolean | null;
  createdAt: string | null;
  raw: UnknownRecord;
}

export interface LearnerVersionEvent {
  id: string | null;
  eventType: string;
  createdAt: string | null;
  assertionsAdded: number | null;
  assertionsSuperseded: number | null;
  raw: UnknownRecord;
}

export interface LearnerVersionDetailModel {
  id: string | null;
  sequenceNumber: number | null;
  parentRevisionId: string | null;
  sessionId: string | null;
  turnId: string | null;
  createdAt: string | null;
  targetKnowledgePointId: string | null;
  assertionsAddedCount: number | null;
  assertionsSupersededCount: number | null;
  addedRelations: LearnerVersionRelation[];
  supersededRelationIds: string[];
  masteryScore: number | null;
  currentLevel: number | null;
  masterySummary: string;
  misconceptionChanges: string[];
  evidenceChanges: string[];
  recommendation: string | null;
  recommendationLabel: string | null;
  events: LearnerVersionEvent[];
  raw: UnknownRecord;
}

const statusLabels: Record<string, string> = {
  PENDING: "等待处理",
  APPLIED: "已应用",
  FAILED: "失败",
  PROJECTED: "已投影",
};

const learnerPredicateLabels: Record<string, string> = {
  HAS_KNOWLEDGE_STATE: "知识状态",
  HAS_MASTERY_EVIDENCE: "掌握证据",
  HAS_MISCONCEPTION: "误解",
  REQUIRES_REVIEW: "需要复习",
  BLOCKED_BY_PREREQUISITE: "被前置知识阻塞",
  READY_FOR_PROMOTION: "可进入更高层级",
  LEARNING_GOAL: "学习目标",
  RECENTLY_PRACTICED: "最近练习",
  NEEDS_TRANSFER_EVIDENCE: "需要迁移证据",
  USER_SUPPLIED: "用户提供主题",
};

const decisionLabels: Record<string, string> = {
  PROMOTE: "提升认知层级",
  HOLD: "保持当前进度",
  REMEDIATE: "补救学习",
  REVIEW_PREREQUISITE: "复习前置知识",
  CHANGE_EXPLANATION: "更换解释方式",
  REQUEST_MORE_EVIDENCE: "收集更多掌握证据",
  REVIEW: "安排复习",
  ASSESS_FOR_PROMOTION: "检测是否可进阶",
};

export function versionStatusLabel(value: string | null): string {
  if (!value) return "后端未提供";
  return statusLabels[value] ?? humanizeUnknown(value);
}

export function learnerRelationLabel(value: string): string {
  return learnerPredicateLabels[value] ?? humanizeUnknown(value);
}

export function learnerDecisionLabel(value: string): string {
  return decisionLabels[value] ?? humanizeUnknown(value);
}

export function adaptDomainVersionDetail(
  value: unknown,
): DomainVersionDetailModel | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const summary = asRecord(raw.summary) ?? {};
  const nodesAdded = metric(summary, ["nodes_added", "added_nodes"]);
  const nodesUpdated = metric(summary, ["nodes_updated", "updated_nodes"]);
  const relationsAdded = metric(summary, ["assertions_added", "relations_added"]);
  const relationsSuperseded = metric(summary, [
    "assertions_superseded",
    "relations_superseded",
    "superseded_relations",
  ]);
  const conflicts = metric(summary, ["conflict_count", "conflicts"]);
  const sourceChanges = metric(summary, [
    "provenance_links_added",
    "source_changes",
    "sources_added",
  ]);
  const sentences: string[] = [];
  appendMetricSentence(sentences, nodesAdded, "新增节点");
  appendMetricSentence(sentences, nodesUpdated, "更新节点");
  appendMetricSentence(sentences, relationsAdded, "新增关系");
  appendMetricSentence(sentences, relationsSuperseded, "替代关系");
  appendMetricSentence(sentences, conflicts, "记录冲突");
  appendMetricSentence(sentences, sourceChanges, "来源变化");
  const explicitSummary = firstText(summary, "description", "text", "summary");
  const manifest = asRecord(raw.manifest);
  return {
    id: firstText(raw, "id", "revision_id"),
    sequenceNumber: firstNumber(raw, "sequence_number", "sequence"),
    status: firstText(raw, "status"),
    projectionStatus: firstText(raw, "projection_status"),
    parentRevisionId: firstText(raw, "parent_revision_id", "base_revision_id"),
    hasParentField:
      Object.hasOwn(raw, "parent_revision_id") ||
      Object.hasOwn(raw, "base_revision_id"),
    createdBy: firstText(raw, "created_by"),
    modelRunId: firstText(raw, "model_run_id"),
    createdAt: firstText(raw, "created_at"),
    projectedAt: firstText(raw, "projected_at", "applied_at"),
    nodesAdded,
    relationsAdded,
    relationsSuperseded,
    conflicts,
    sourceChanges,
    nodesUpdated,
    summaryNarrative:
      explicitSummary ??
      (sentences.length > 0
        ? `${sentences.join("；")}。`
        : "后端未提供可展示的版本摘要。"),
    manifestFacts: manifest ? adaptManifestFacts(manifest) : [],
    raw,
  };
}

export function adaptLearnerVersionDetail(
  value: unknown,
): LearnerVersionDetailModel | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const summary = asRecord(raw.change_summary) ?? {};
  const eventRows = recordArray(raw.events);
  const events = eventRows.map(adaptLearnerEvent);
  const detailed = recordArray(raw.assertions).map(adaptLearnerRelation);
  const detailedIds = new Set(
    detailed.map((item) => item.id).filter((item): item is string => item !== null),
  );
  const eventRelations = eventRows.flatMap((event) => {
    const delta = asRecord(event.delta) ?? {};
    return recordArray(delta.assertions_added)
      .map(adaptLearnerRelation)
      .filter((item) => !item.id || !detailedIds.has(item.id));
  });
  const addedRelations = [...detailed, ...eventRelations];
  const supersededRelationIds = uniqueStrings(
    eventRows.flatMap((event) => {
      const delta = asRecord(event.delta) ?? {};
      return textArray(delta.assertions_superseded);
    }),
  );
  const masteryScore = firstNumber(summary, "mastery_score");
  const currentLevel = firstNumber(summary, "current_level");
  const masteryDelta = firstNumber(summary, "mastery_delta", "mastery_change");
  const recommendation = firstText(summary, "recommended_action", "decision");
  const misconceptionChanges = addedRelations
    .filter((item) => item.predicate === "HAS_MISCONCEPTION")
    .map((item) => item.description);
  const evidenceChanges = addedRelations
    .filter((item) => item.predicate === "HAS_MASTERY_EVIDENCE")
    .map((item) => item.description);
  return {
    id: firstText(raw, "id", "revision_id"),
    sequenceNumber: firstNumber(raw, "sequence_number", "sequence"),
    parentRevisionId: firstText(raw, "parent_revision_id"),
    sessionId: firstText(raw, "session_id"),
    turnId: firstText(raw, "turn_id") ?? firstText(summary, "turn_id"),
    createdAt: firstText(raw, "created_at"),
    targetKnowledgePointId: firstText(
      summary,
      "target_knowledge_point_id",
      "knowledge_point_id",
    ),
    assertionsAddedCount:
      firstNumber(raw, "assertions_added") ??
      (addedRelations.length > 0 ? addedRelations.length : null),
    assertionsSupersededCount:
      firstNumber(raw, "assertions_superseded") ??
      (supersededRelationIds.length > 0 ? supersededRelationIds.length : null),
    addedRelations,
    supersededRelationIds,
    masteryScore,
    currentLevel,
    masterySummary: masterySummary(masteryScore, currentLevel, masteryDelta),
    misconceptionChanges,
    evidenceChanges,
    recommendation,
    recommendationLabel: recommendation
      ? learnerDecisionLabel(recommendation)
      : null,
    events,
    raw,
  };
}

function metric(
  summary: UnknownRecord,
  keys: string[],
): VersionChangeMetric {
  for (const key of keys) {
    if (!Object.hasOwn(summary, key)) continue;
    const value = summary[key];
    const number = numberValue(value);
    if (number !== null) return { provided: true, count: number, items: [] };
    if (Array.isArray(value)) {
      return {
        provided: true,
        count: value.length,
        items: value.map(versionItemLabel),
      };
    }
    const record = asRecord(value);
    if (record) {
      const count = firstNumber(record, "count", "total");
      const items = Array.isArray(record.items)
        ? record.items.map(versionItemLabel)
        : [];
      return {
        provided: true,
        count: count ?? (items.length > 0 ? items.length : null),
        items,
      };
    }
    return { provided: true, count: null, items: [] };
  }
  return { provided: false, count: null, items: [] };
}

function versionItemLabel(value: unknown): string {
  const text = textValue(value);
  if (text) return text;
  const record = asRecord(value);
  if (!record) return "未命名记录";
  const merged = mergedRecord(record);
  return (
    firstText(
      merged,
      "natural_language_description",
      "display_name",
      "canonical_name",
      "name",
      "description",
      "id",
    ) ?? "未命名记录"
  );
}

function appendMetricSentence(
  sentences: string[],
  metricValue: VersionChangeMetric,
  label: string,
): void {
  if (!metricValue.provided || metricValue.count === null) return;
  sentences.push(`${label} ${metricValue.count}`);
}

function adaptManifestFacts(manifest: UnknownRecord): Array<{
  label: string;
  value: string;
}> {
  const definitions: Array<[string, string[]]> = [
    ["知识点总数", ["knowledge_point_count"]],
    ["关系总数", ["assertion_count"]],
    ["来源总数", ["source_count"]],
    ["节点总数", ["node_count"]],
  ];
  return definitions.flatMap(([label, keys]) => {
    const value = firstNumber(manifest, ...keys);
    return value === null ? [] : [{ label, value: String(value) }];
  });
}

function adaptLearnerRelation(value: UnknownRecord): LearnerVersionRelation {
  const relation = mergedRecord(value);
  const predicate =
    firstText(relation, "predicate", "relation_type", "predicate_key") ??
    "UNKNOWN";
  return {
    id: firstText(relation, "id", "assertion_id"),
    predicate,
    predicateLabel: learnerRelationLabel(predicate),
    subjectId: firstText(relation, "subject_id"),
    objectId: firstText(relation, "object_id"),
    description:
      firstText(
        relation,
        "natural_language_description",
        "description",
      ) ?? `新增${learnerRelationLabel(predicate)}关系`,
    confidence: firstNumber(relation, "confidence"),
    active: booleanValue(relation.is_active ?? relation.active),
    createdAt: firstText(relation, "created_at", "valid_from"),
    raw: value,
  };
}

function adaptLearnerEvent(value: UnknownRecord): LearnerVersionEvent {
  const delta = asRecord(value.delta) ?? {};
  return {
    id: firstText(value, "id"),
    eventType: firstText(value, "event_type", "type") ?? "UNKNOWN_EVENT",
    createdAt: firstText(value, "created_at"),
    assertionsAdded: collectionCount(delta.assertions_added),
    assertionsSuperseded: collectionCount(delta.assertions_superseded),
    raw: value,
  };
}

function collectionCount(value: unknown): number | null {
  const number = numberValue(value);
  if (number !== null) return number;
  return Array.isArray(value) ? value.length : null;
}

function masterySummary(
  score: number | null,
  level: number | null,
  delta: number | null,
): string {
  if (score === null && level === null && delta === null)
    return "后端未提供掌握度变化。";
  const parts: string[] = [];
  if (score !== null) parts.push(`本轮掌握度 ${displayPercent(score)}`);
  if (level !== null) parts.push(`认知层级 L${level}`);
  if (delta !== null) {
    const sign = delta > 0 ? "+" : "";
    parts.push(`变化 ${sign}${displayPercent(delta)}`);
  } else {
    parts.push("后端未提供前值，无法计算增减");
  }
  return `${parts.join("；")}。`;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
