import {
  asRecord,
  firstNumber,
  firstText,
  humanizeUnknown,
  mergedRecord,
  recordArray,
  textValue,
  type UnknownRecord,
} from "./dataAdapter";

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

const relationLabels: Record<string, string> = {
  IS_A: "属于",
  PART_OF: "是组成部分",
  REQUIRES: "需要先掌握",
  PREREQUISITE_OF: "前置于",
  ENABLES: "为学习或应用提供基础",
  EXPLAINS: "解释",
  CONTRASTS_WITH: "与之形成对照",
  SIMILAR_TO: "与之相似",
  APPLIES_TO: "适用于",
  FAILS_WHEN: "在该条件下失效",
  SUPPORTED_BY: "由来源支持",
  DERIVED_FROM: "源自",
  EXAMPLE_OF: "是其示例",
  COUNTEREXAMPLE_OF: "是其反例",
  MISCONCEPTION_ABOUT: "是关于它的误解",
  ASSESSES: "用于检测",
  TEACHES: "用于教授",
  MASTERED_BY: "被学习者掌握",
  SUPERSEDES: "替代",
  CONFLICTS_WITH: "与之冲突",
};

const nodeTypeLabels: Record<string, string> = {
  Domain: "领域",
  Theory: "理论",
  KnowledgePoint: "知识点",
  Definition: "定义",
  Method: "方法",
  Example: "示例",
  Counterexample: "反例",
  Misconception: "误解",
  Question: "掌握检测",
  LearningStage: "教学阶段",
  SourceDocument: "来源文档",
  SourceSpan: "来源片段",
  EntityType: "实体类型",
  RelationType: "关系类型",
  EpistemicStatus: "知识状态",
  Constraint: "约束",
  ConflictSet: "冲突集合",
  Session: "学习会话",
  LearningGoal: "学习目标",
  MasteryEvidence: "掌握证据",
  ErrorPattern: "错误模式",
  Learner: "学习者",
  LearnerKnowledgeState: "学习者知识状态",
  LearnerGraphResource: "学习图谱资源",
};

const epistemicLabels: Record<string, string> = {
  CONFIRMED: "已确认",
  PROPOSED: "待审提议",
  INFERRED: "推断",
  USER_SUPPLIED: "用户提供",
  UNVERIFIED: "未验证",
  DISPUTED: "有争议",
  SUPERSEDED: "已被替代",
};

export function relationTypeLabel(value: string): string {
  return relationLabels[value] ?? humanizeUnknown(value);
}

export function domainNodeTypeLabel(value: string): string {
  return nodeTypeLabels[value] ?? humanizeUnknown(value);
}

export function epistemicStatusLabel(value: string | null): string {
  if (!value) return "状态未知";
  return epistemicLabels[value] ?? humanizeUnknown(value);
}

export function adaptDomainNodeDetail(value: unknown): DomainNodeDetailModel | null {
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
      adaptIncidentRelation(item, "incoming"),
    ),
    outgoing: recordArray(raw.outgoing_assertions).map((item) =>
      adaptIncidentRelation(item, "outgoing"),
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
    "未知主体",
  );
  const object = adaptNode(
    asRecord(raw.object) ?? { id: firstText(assertion, "object_id") },
    "未知客体",
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
      ) ?? `${subject.name} ${relationTypeLabel(relationType)} ${object.name}`,
    relationType,
    relationTypeLabel: relationTypeLabel(relationType),
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
    predicateLabel: relationTypeLabel(predicate),
    description:
      firstText(
        assertion,
        "natural_language_description",
        "description",
      ) ?? relationTypeLabel(predicate),
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
