import {
  asRecord,
  firstNumber,
  firstText,
  mergedRecord,
  recordArray,
  textValue,
  type UnknownRecord,
} from "./dataAdapter";
import type { UiLocale } from "@/types/app";

export interface DomainNodeSummary {
  id: string | null;
  name: string;
  type: string;
  epistemicStatus: string | null;
  confidence: number | null;
  raw: UnknownRecord;
}

export interface DomainRelationSummary {
  id: string | null;
  predicate: string;
  predicateLabel: string;
  description: string;
  endpoint: DomainNodeSummary | null;
  endpointId: string | null;
  active: boolean | null;
  raw: UnknownRecord;
}

export interface DomainSourceSummary {
  id: string | null;
  documentName: string | null;
  page: number | null;
  excerpt: string | null;
  raw: UnknownRecord;
}

export interface DomainLearningStage {
  id: string | null;
  level: number | null;
  objective: string | null;
  strategy: string | null;
  diagnosticQuestion: string | null;
  raw: UnknownRecord;
}

export interface DomainNodeDetailModel {
  node: DomainNodeSummary;
  plainDefinition: string | null;
  formalDefinition: string | null;
  domain: string | null;
  theories: DomainNodeSummary[];
  prerequisites: DomainNodeSummary[];
  relatedNodes: DomainNodeSummary[];
  incoming: DomainRelationSummary[];
  outgoing: DomainRelationSummary[];
  learningStages: DomainLearningStage[];
  sources: DomainSourceSummary[];
  graphRevision: string | null;
  raw: UnknownRecord;
}

export interface AssertionHistoryItem {
  id: string | null;
  description: string;
  validFrom: string | null;
  validTo: string | null;
  raw: UnknownRecord;
}

export interface DomainAssertionDetailModel {
  id: string | null;
  subject: DomainNodeSummary;
  object: DomainNodeSummary;
  description: string;
  relationType: string;
  relationTypeLabel: string;
  confidence: number | null;
  epistemicStatus: string | null;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean | null;
  sources: DomainSourceSummary[];
  conflicts: AssertionHistoryItem[];
  supersedes: AssertionHistoryItem[];
  supersededBy: AssertionHistoryItem[];
  graphRevision: string | null;
  raw: UnknownRecord;
}

const relationLabels: Record<string, readonly [string, string]> = {
  IS_A: ["属于", "Is a"],
  PART_OF: ["是组成部分", "Part of"],
  REQUIRES: ["需要先掌握", "Requires"],
  PREREQUISITE_OF: ["前置于", "Prerequisite for"],
  ENABLES: ["为学习或应用提供基础", "Enables"],
  EXPLAINS: ["解释", "Explains"],
  CONTRASTS_WITH: ["与之形成对照", "Contrasts with"],
  SIMILAR_TO: ["与之相似", "Similar to"],
  APPLIES_TO: ["适用于", "Applies to"],
  FAILS_WHEN: ["在该条件下失效", "Fails when"],
  SUPPORTED_BY: ["由来源支持", "Supported by"],
  DERIVED_FROM: ["源自", "Derived from"],
  EXAMPLE_OF: ["是其示例", "Example of"],
  COUNTEREXAMPLE_OF: ["是其反例", "Counterexample of"],
  MISCONCEPTION_ABOUT: ["是关于它的误解", "Misconception about"],
  ASSESSES: ["用于检测", "Assesses"],
  TEACHES: ["用于教授", "Teaches"],
  MASTERED_BY: ["被学习者掌握", "Mastered by"],
  SUPERSEDES: ["替代", "Supersedes"],
  CONFLICTS_WITH: ["与之冲突", "Conflicts with"],
};

const nodeTypeLabels: Record<string, readonly [string, string]> = {
  Domain: ["领域", "Domain"],
  Theory: ["理论", "Theory"],
  KnowledgePoint: ["知识点", "Knowledge point"],
  Definition: ["定义", "Definition"],
  Method: ["方法", "Method"],
  Example: ["示例", "Example"],
  Counterexample: ["反例", "Counterexample"],
  Misconception: ["误解", "Misconception"],
  Question: ["掌握检测", "Mastery check"],
  LearningStage: ["教学阶段", "Learning stage"],
  SourceDocument: ["来源文档", "Source material"],
  SourceSpan: ["来源片段", "Source excerpt"],
  EntityType: ["实体类型", "Content type"],
  RelationType: ["关系类型", "Relationship type"],
  EpistemicStatus: ["知识状态", "Knowledge status"],
  Constraint: ["约束", "Constraint"],
  ConflictSet: ["冲突集合", "Conflict set"],
  Session: ["学习会话", "Learning session"],
  LearningGoal: ["学习目标", "Learning goal"],
  MasteryEvidence: ["掌握证据", "Mastery evidence"],
  ErrorPattern: ["错误模式", "Error pattern"],
  Learner: ["学习者", "Learner"],
  LearnerKnowledgeState: ["学习者知识状态", "Learner progress"],
  LearnerGraphResource: ["学习图谱资源", "Learning map resource"],
};

const epistemicLabels: Record<string, readonly [string, string]> = {
  CONFIRMED: ["已确认", "Confirmed"],
  PROPOSED: ["待审提议", "Proposed"],
  INFERRED: ["推断", "Inferred"],
  USER_SUPPLIED: ["用户提供", "User supplied"],
  UNVERIFIED: ["未验证", "Unverified"],
  DISPUTED: ["有争议", "Disputed"],
  SUPERSEDED: ["已被替代", "Superseded"],
};

function localizedLabel(value: readonly [string, string], locale: UiLocale): string {
  return value[locale === "en" ? 1 : 0];
}

export function relationTypeLabel(value: string, locale: UiLocale = "zh-CN"): string {
  return localizedLabel(relationLabels[value] ?? ["其他知识关系", "Other knowledge relationship"], locale);
}

export function domainNodeTypeLabel(value: string, locale: UiLocale = "zh-CN"): string {
  return localizedLabel(nodeTypeLabels[value] ?? ["学习内容", "Learning content"], locale);
}

export function epistemicStatusLabel(value: string | null, locale: UiLocale = "zh-CN"): string {
  if (!value) return locale === "en" ? "Status unavailable" : "状态未知";
  return localizedLabel(epistemicLabels[value] ?? ["状态待确认", "Pending confirmation"], locale);
}

export function adaptDomainNodeDetail(value: unknown, locale: UiLocale = "zh-CN"): DomainNodeDetailModel | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const nodeRecord = asRecord(raw.node) ?? raw;
  const node = adaptNode(nodeRecord);
  const mergedNode = mergedRecord(nodeRecord);
  return {
    node,
    plainDefinition:
      firstText(raw, "natural_language_definition") ??
      firstText(
        mergedNode,
        "plain_language_definition",
        "plain_definition",
        "summary",
        "description",
      ),
    formalDefinition: firstText(mergedNode, "formal_definition"),
    domain: firstText(mergedNode, "knowledge_domain", "domain"),
    theories: recordArray(raw.theories).map((item) => adaptNode(item)),
    prerequisites: recordArray(raw.prerequisites).map((item) => adaptNode(item)),
    relatedNodes: [
      ...recordArray(raw.related_knowledge_points),
      ...recordArray(raw.related_nodes),
    ].map((item) => adaptNode(item)),
    incoming: recordArray(raw.incoming_assertions).map((item) =>
      adaptIncidentRelation(item, "incoming", locale),
    ),
    outgoing: recordArray(raw.outgoing_assertions).map((item) =>
      adaptIncidentRelation(item, "outgoing", locale),
    ),
    learningStages: recordArray(raw.learning_stages).map(adaptLearningStage),
    sources: recordArray(raw.sources).map(adaptSource),
    graphRevision: firstText(
      raw,
      "graph_revision",
      "revision_id",
      "graph_revision_id",
    ),
    raw,
  };
}

export function adaptDomainAssertionDetail(
  value: unknown,
  locale: UiLocale = "zh-CN",
): DomainAssertionDetailModel | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const assertionRecord = asRecord(raw.assertion) ?? raw;
  const assertion = mergedRecord(assertionRecord);
  const relationRecord = mergedRecord(raw.relation_type);
  const relationType =
    firstText(assertion, "predicate_key", "predicate", "relation_type") ??
    firstText(relationRecord, "name") ??
    "UNKNOWN";
  const supersedes = [
    ...recordArray(raw.superseded_assertions),
    ...(asRecord(raw.superseded_relation) ? [asRecord(raw.superseded_relation)!] : []),
  ];
  const supersededBy = [
    ...recordArray(raw.replacements),
    ...(asRecord(raw.superseding_relation) ? [asRecord(raw.superseding_relation)!] : []),
  ];
  if (supersedes.length === 0) {
    const id = firstText(assertion, "supersedes_assertion_id");
    if (id) supersedes.push({ id });
  }
  if (supersededBy.length === 0) {
    const id = firstText(assertion, "superseded_by_id");
    if (id) supersededBy.push({ id });
  }
  const subject = adaptNode(
    asRecord(raw.subject) ?? { id: firstText(assertion, "subject_id") },
    locale === "en" ? "Unknown source" : "未知主体",
  );
  const object = adaptNode(
    asRecord(raw.object) ?? { id: firstText(assertion, "object_id") },
    locale === "en" ? "Unknown target" : "未知客体",
  );
  const active = booleanValue(assertion.is_active ?? assertion.active);
  const validTo = firstText(assertion, "valid_to", "superseded_at");
  return {
    id: firstText(assertion, "id", "assertion_id"),
    subject,
    object,
    description:
      firstText(
        assertion,
        "natural_language_description",
        "description",
      ) ?? `${subject.name} ${relationTypeLabel(relationType, locale)} ${object.name}`,
    relationType,
    relationTypeLabel: relationTypeLabel(relationType, locale),
    confidence: firstNumber(assertion, "confidence"),
    epistemicStatus: firstText(assertion, "epistemic_status"),
    validFrom: firstText(assertion, "valid_from", "created_at"),
    validTo,
    isActive: active ?? (validTo ? false : null),
    sources: recordArray(raw.sources).map(adaptSource),
    conflicts: recordArray(raw.conflicts).map(adaptHistoryItem),
    supersedes: supersedes.map(adaptHistoryItem),
    supersededBy: supersededBy.map(adaptHistoryItem),
    graphRevision:
      firstText(raw, "graph_revision", "revision_id", "graph_revision_id") ??
      firstText(assertion, "graph_revision_id"),
    raw,
  };
}

function adaptNode(value: UnknownRecord, fallback = "未命名节点"): DomainNodeSummary {
  const merged = mergedRecord(value);
  return {
    id: firstText(merged, "id", "node_id"),
    name:
      firstText(
        merged,
        "display_name",
        "canonical_name",
        "name",
        "title",
        "label",
      ) ?? fallback,
    type:
      firstText(merged, "node_type", "entity_type", "type") ?? "Unknown",
    epistemicStatus: firstText(merged, "epistemic_status"),
    confidence: firstNumber(merged, "source_confidence", "confidence"),
    raw: value,
  };
}

function adaptIncidentRelation(
  value: UnknownRecord,
  direction: "incoming" | "outgoing",
  locale: UiLocale,
): DomainRelationSummary {
  const assertionRecord = asRecord(value.assertion) ?? value;
  const assertion = mergedRecord(assertionRecord);
  const endpointRecord = asRecord(
    direction === "incoming" ? value.subject : value.object,
  );
  const predicate =
    firstText(assertion, "predicate_key", "predicate", "relation_type") ??
    "UNKNOWN";
  return {
    id: firstText(assertion, "id", "assertion_id"),
    predicate,
    predicateLabel: relationTypeLabel(predicate, locale),
    description:
      firstText(
        assertion,
        "natural_language_description",
        "description",
      ) ?? relationTypeLabel(predicate, locale),
    endpoint: endpointRecord ? adaptNode(endpointRecord) : null,
    endpointId:
      endpointRecord
        ? firstText(mergedRecord(endpointRecord), "id", "node_id")
        : firstText(
            assertion,
            direction === "incoming" ? "subject_id" : "object_id",
          ),
    active: booleanValue(assertion.is_active ?? assertion.active),
    raw: value,
  };
}

function adaptSource(value: UnknownRecord): DomainSourceSummary {
  const source = mergedRecord(value);
  const documentRecord = asRecord(source.source_document);
  const document = documentRecord ? mergedRecord(documentRecord) : {};
  return {
    id: firstText(source, "id", "source_span_id"),
    documentName:
      firstText(
        document,
        "original_filename",
        "filename",
        "display_name",
        "name",
        "title",
      ) ?? firstText(source, "document_id"),
    page: firstNumber(source, "page_number", "page_start"),
    excerpt: firstText(source, "text", "content", "excerpt"),
    raw: value,
  };
}

function adaptLearningStage(value: UnknownRecord): DomainLearningStage {
  const stage = mergedRecord(value);
  return {
    id: firstText(stage, "id", "node_id"),
    level: firstNumber(stage, "cognitive_level"),
    objective: firstText(stage, "learning_objective"),
    strategy: firstText(stage, "teaching_strategy"),
    diagnosticQuestion: firstText(stage, "diagnostic_question"),
    raw: value,
  };
}

function adaptHistoryItem(value: UnknownRecord): AssertionHistoryItem {
  const item = mergedRecord(value);
  return {
    id: firstText(item, "id", "assertion_id"),
    description:
      firstText(
        item,
        "natural_language_description",
        "description",
        "reason",
      ) ?? "暂无描述",
    validFrom: firstText(item, "valid_from", "created_at"),
    validTo: firstText(item, "valid_to", "superseded_at"),
    raw: value,
  };
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function recordLabel(value: unknown): string {
  const record = asRecord(value);
  if (!record) return textValue(value) ?? "暂无记录";
  return firstText(mergedRecord(record), "name", "title", "description", "id") ?? "记录";
}
