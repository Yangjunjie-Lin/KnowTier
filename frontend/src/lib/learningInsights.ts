import type {
  ChatResponse,
  CognitiveLevel,
  CytoscapeGraph,
  EvidenceItem,
  GraphDetailResponse,
  LearnerModelItem,
  LearnerModelResponse,
  UUID,
} from "@/types/api";

export type LearningTargetSource = "chat" | "navigation";

export interface LearningTargetReference {
  id: UUID;
  name: string;
  source: LearningTargetSource;
}

export interface NavigationLearningTarget {
  id?: UUID;
  name: string;
}

export type PrerequisiteStatus =
  | "mastered"
  | "learning"
  | "review"
  | "blocked"
  | "no-record"
  | "unknown";

export interface PrerequisiteInsight {
  id: UUID;
  name: string;
  currentLevel: CognitiveLevel | null;
  masteryScore: number | null;
  status: PrerequisiteStatus;
  statusLabel: string;
  isBlocking: boolean | null;
  statusExplanation: string;
  recommendedAction: string;
}

export type PrerequisiteStructureSource =
  | "domain-detail"
  | "learner-model"
  | "unavailable";

export interface PrerequisiteAdaptation {
  items: PrerequisiteInsight[];
  structureSource: PrerequisiteStructureSource;
}

export type MisconceptionStatus =
  | "pending"
  | "verify"
  | "active"
  | "mitigated"
  | "resolved"
  | "superseded";

export interface MisconceptionInsight {
  id: string;
  description: string;
  status: MisconceptionStatus;
  statusLabel: string;
  confidence: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  relatedEvidenceCount: number;
  sourceTurnId: UUID | null;
  sourceRelationId: UUID | null;
  isActive: boolean | null;
  supersededByRelationId: UUID | null;
  recommendedAction: string;
  source: "learner-graph" | "learner-model" | "learner-evidence";
}

export interface MisconceptionGroups {
  current: MisconceptionInsight[];
  history: MisconceptionInsight[];
}

export interface EvidenceDimension {
  key: string;
  label: string;
  score: number;
}

export interface EvidenceInsight {
  id: UUID;
  evidenceType: string;
  evidenceForm: string;
  cognitiveLevel: CognitiveLevel | null;
  overallScore: number | null;
  dimensions: EvidenceDimension[];
  confidence: number | null;
  answerSummary: string | null;
  graderExplanation: string | null;
  sessionId: UUID | null;
  turnId: UUID | null;
  createdAt: string | null;
  isUsedForCurrentMastery: boolean | null;
}

export interface LearningInsights {
  targetKnowledgePoint: LearningTargetReference | null;
  prerequisites: PrerequisiteInsight[];
  prerequisiteStructureSource: PrerequisiteStructureSource;
  misconceptions: MisconceptionGroups;
  evidence: EvidenceInsight[];
  lastUpdatedAt: string | null;
  isRefreshing: boolean;
  partialErrors: Partial<Record<LearningInsightSource, unknown>>;
}

export type LearningInsightSource =
  | "learnerModel"
  | "learnerEvidence"
  | "domainDetail"
  | "learnerGraph";

interface PrerequisiteInput {
  target: LearningTargetReference;
  learnerModel?: LearnerModelResponse;
  domainDetail?: GraphDetailResponse;
  learnerGraph?: CytoscapeGraph;
  now?: number;
}

interface MisconceptionInput {
  target: LearningTargetReference;
  learnerModel?: LearnerModelResponse;
  learnerEvidence?: { items: EvidenceItem[] };
  learnerGraph?: CytoscapeGraph;
}

interface EvidenceInput {
  target: LearningTargetReference;
  learnerEvidence?: { items: EvidenceItem[] };
  learnerGraph?: CytoscapeGraph;
}

const prerequisiteStatusLabels: Record<PrerequisiteStatus, string> = {
  mastered: "已掌握",
  learning: "学习中",
  review: "需要复习",
  blocked: "前置阻塞",
  "no-record": "尚无学习记录",
  unknown: "状态未知",
};

const misconceptionStatusLabels: Record<MisconceptionStatus, string> = {
  pending: "待澄清",
  verify: "仍需验证",
  active: "当前有效",
  mitigated: "已缓解",
  resolved: "已解决",
  superseded: "已被新状态替代",
};

const dimensionLabels: Record<string, string> = {
  correctness: "正确性",
  reasoning: "推理质量",
  relevance: "相关性",
  completeness: "完整性",
  independence: "独立性",
  transfer: "迁移能力",
  question_understanding: "问题理解",
};

const evidenceTypeLabels: Record<string, string> = {
  RECOGNITION: "识别",
  EXPLANATION: "解释",
  WORKED_EXAMPLE: "示例演练",
  APPLICATION: "应用",
  CRITIQUE: "批判分析",
  TRANSFER: "迁移",
  CREATION: "创造",
  SELF_REPORT: "自我报告",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : null;
}

function cognitiveLevel(value: unknown): CognitiveLevel | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6
    ? (value as CognitiveLevel)
    : null;
}

function recordText(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = nonEmptyText(record[key]);
    if (value) return value;
  }
  const properties = record.properties;
  if (isRecord(properties)) {
    for (const key of keys) {
      const value = nonEmptyText(properties[key]);
      if (value) return value;
    }
  }
  return null;
}

function detailData(detail?: GraphDetailResponse): Record<string, unknown> | null {
  return detail && isRecord(detail.data) ? detail.data : null;
}

function modelItemRecord(item: LearnerModelItem): Record<string, unknown> {
  return item as unknown as Record<string, unknown>;
}

function graphEdges(graph?: CytoscapeGraph): Array<Record<string, unknown>> {
  if (!graph?.elements || !Array.isArray(graph.elements.edges)) return [];
  return graph.elements.edges
    .map((edge) => edge.data as unknown)
    .filter(isRecord);
}

export function resolveLearningTarget(
  latestChatResponse: ChatResponse | null | undefined,
  navigationTarget: NavigationLearningTarget | null | undefined,
): LearningTargetReference | null {
  const chatTarget = latestChatResponse?.target_knowledge_point;
  const chatId = nonEmptyText(chatTarget?.id);
  if (chatId) {
    return {
      id: chatId,
      name: nonEmptyText(chatTarget?.name) ?? chatId,
      source: "chat",
    };
  }
  const navigationId = nonEmptyText(navigationTarget?.id);
  if (!navigationId) return null;
  return {
    id: navigationId,
    name: nonEmptyText(navigationTarget?.name) ?? navigationId,
    source: "navigation",
  };
}

function prerequisiteNodes(
  targetItem: LearnerModelItem | undefined,
  domainDetail: GraphDetailResponse | undefined,
): { nodes: Array<Record<string, unknown>>; source: PrerequisiteStructureSource } {
  const data = detailData(domainDetail);
  if (data && Array.isArray(data.prerequisites)) {
    return {
      nodes: data.prerequisites.filter(isRecord),
      source: "domain-detail",
    };
  }
  const targetRecord = targetItem ? modelItemRecord(targetItem) : null;
  if (targetRecord && Array.isArray(targetRecord.prerequisites)) {
    return {
      nodes: targetRecord.prerequisites.filter(isRecord),
      source: "learner-model",
    };
  }
  return { nodes: [], source: "unavailable" };
}

function explicitPrerequisiteStatus(value: unknown): PrerequisiteStatus | null {
  const normalized = nonEmptyText(value)?.toLowerCase().replaceAll("-", "_");
  if (!normalized) return null;
  if (["mastered", "complete", "completed"].includes(normalized)) return "mastered";
  if (["learning", "in_progress", "progress"].includes(normalized)) return "learning";
  if (["review", "needs_review", "remediate"].includes(normalized)) return "review";
  if (["blocked", "not_mastered", "prerequisite_blocked"].includes(normalized)) {
    return "blocked";
  }
  if (["none", "unknown", "unavailable"].includes(normalized)) return "unknown";
  return null;
}

function dueForReview(item: LearnerModelItem, now: number): boolean {
  const action = nonEmptyText(item.recommended_action)?.toUpperCase();
  if (action === "REVIEW" || action === "REMEDIATE") return true;
  if (!item.next_review_at) return false;
  const reviewAt = Date.parse(item.next_review_at);
  return Number.isFinite(reviewAt) && reviewAt <= now;
}

function derivedPrerequisiteStatus(
  state: LearnerModelItem,
  explicit: PrerequisiteStatus | null,
  now: number,
): PrerequisiteStatus {
  if (explicit) return explicit;
  if (dueForReview(state, now)) return "review";
  const score = finiteScore(state.mastery_score);
  const level = cognitiveLevel(state.current_level);
  if (score === null || level === null) return "unknown";
  if (score >= 0.75 && level >= 2) return "mastered";
  if (score >= 0.35) return "learning";
  return "review";
}

function prerequisiteExplanation(status: PrerequisiteStatus): string {
  switch (status) {
    case "mastered":
      return "后端状态或掌握记录表明该前置知识已达到继续学习的条件。";
    case "learning":
      return "已有学习记录，但仍需要更多独立证据巩固。";
    case "review":
      return "当前记录提示应先复习或补充基础证据。";
    case "blocked":
      return "后端明确标记该前置条件尚未满足，当前目标可能受阻。";
    case "no-record":
      return "领域图谱声明了该前置知识，但个人模型尚无对应 ID 的学习记录。";
    case "unknown":
      return "后端返回的信息不足以确定掌握状态。";
  }
}

function prerequisiteRecommendation(status: PrerequisiteStatus): string {
  switch (status) {
    case "mastered":
      return "可按需快速复习后继续当前目标。";
    case "learning":
      return "继续练习并完成一次独立掌握检测。";
    case "review":
      return "先完成针对性复习，再返回当前目标。";
    case "blocked":
      return "优先学习该前置知识，并由服务器确认新目标。";
    case "no-record":
      return "开始学习该前置知识以建立首条学习记录。";
    case "unknown":
      return "重试同步；在状态明确前保守地进行复习。";
  }
}

function hasBlockingEdge(
  graph: CytoscapeGraph | undefined,
  targetId: UUID,
  prerequisiteId: UUID,
): boolean {
  return graphEdges(graph).some((edge) => {
    const predicate = nonEmptyText(edge.predicate) ?? nonEmptyText(edge.relation_type);
    const active = edge.active !== false && !nonEmptyText(edge.valid_to);
    return (
      active &&
      predicate === "BLOCKED_BY_PREREQUISITE" &&
      nonEmptyText(edge.source) === targetId &&
      nonEmptyText(edge.target) === prerequisiteId
    );
  });
}

export function adaptPrerequisites({
  target,
  learnerModel,
  domainDetail,
  learnerGraph,
  now = Date.now(),
}: PrerequisiteInput): PrerequisiteAdaptation {
  const modelItems = learnerModel?.items ?? [];
  const targetItem = modelItems.find((item) => item.knowledge_point_id === target.id);
  const structure = prerequisiteNodes(targetItem, domainDetail);
  const targetPrerequisiteRecords = targetItem?.prerequisites ?? [];
  const byStateId = new Map(modelItems.map((item) => [item.knowledge_point_id, item]));
  const seen = new Set<string>();
  const items: PrerequisiteInsight[] = [];

  for (const node of structure.nodes) {
    const id =
      nonEmptyText(node.id) ??
      nonEmptyText(node.knowledge_point_id) ??
      (isRecord(node.node) ? nonEmptyText(node.node.id) : null);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const embedded = targetPrerequisiteRecords.find(
      (item) => item.knowledge_point_id === id,
    );
    const state = byStateId.get(id);
    const explicit = explicitPrerequisiteStatus(
      (embedded as unknown as Record<string, unknown> | undefined)?.status,
    );
    const graphBlocked = hasBlockingEdge(learnerGraph, target.id, id);
    const targetSaysBlocked =
      targetItem?.prerequisite_status === "not_mastered" &&
      (explicit === "blocked" || !state);
    const status = state
      ? graphBlocked
        ? "blocked"
        : derivedPrerequisiteStatus(state, explicit, now)
      : "no-record";
    const finalStatus = graphBlocked && status !== "no-record" ? "blocked" : status;
    const name =
      recordText(node, ["display_name", "canonical_name", "knowledge_point", "name", "label"])
      ?? embedded?.knowledge_point
      ?? state?.knowledge_point
      ?? id;
    items.push({
      id,
      name,
      currentLevel: state ? cognitiveLevel(state.current_level) : null,
      masteryScore: state ? finiteScore(state.mastery_score) : null,
      status: finalStatus,
      statusLabel: prerequisiteStatusLabels[finalStatus],
      isBlocking: graphBlocked || targetSaysBlocked || finalStatus === "blocked",
      statusExplanation: prerequisiteExplanation(finalStatus),
      recommendedAction: prerequisiteRecommendation(finalStatus),
    });
  }
  return { items, structureSource: structure.source };
}

function misconceptionStatus(
  edge: Record<string, unknown>,
  active: boolean,
  confidence: number | null,
): MisconceptionStatus {
  const explicit = nonEmptyText(edge.status)?.toLowerCase().replaceAll("-", "_");
  if (explicit) {
    if (["pending", "pending_clarification"].includes(explicit)) return "pending";
    if (["verify", "needs_verification"].includes(explicit)) return "verify";
    if (["active", "current"].includes(explicit)) return "active";
    if (["mitigated", "reduced"].includes(explicit)) return "mitigated";
    if (["resolved", "closed"].includes(explicit)) return "resolved";
    if (["superseded", "replaced"].includes(explicit)) return "superseded";
  }
  if (!active) {
    return nonEmptyText(edge.superseded_by_assertion_id) ? "superseded" : "resolved";
  }
  if (confidence === null) return "pending";
  return confidence < 0.5 ? "verify" : "active";
}

function misconceptionRecommendation(status: MisconceptionStatus): string {
  switch (status) {
    case "pending":
      return "用中性追问澄清学习者的真实理解。";
    case "verify":
      return "安排一道独立问题验证该理解是否仍存在。";
    case "active":
      return "先对比正确概念与当前理解，再完成纠正练习。";
    case "mitigated":
      return "继续用新情境复核，避免误解再次出现。";
    case "resolved":
      return "保留历史记录，后续按需抽查。";
    case "superseded":
      return "以替代它的新状态为准，并保留审计链。";
  }
}

function countRelatedEvidence(
  evidence: readonly EvidenceItem[],
  description: string,
  evidenceId: string | null,
): number {
  return evidence.filter(
    (item) =>
      item.id === evidenceId || item.observed_misconceptions.includes(description),
  ).length;
}

function sortTime(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function adaptMisconceptions({
  target,
  learnerModel,
  learnerEvidence,
  learnerGraph,
}: MisconceptionInput): MisconceptionGroups {
  const evidence = (learnerEvidence?.items ?? []).filter(
    (item) => item.knowledge_point_id === target.id,
  );
  const targetItem = learnerModel?.items.find(
    (item) => item.knowledge_point_id === target.id,
  );
  const all: MisconceptionInsight[] = [];
  const currentDescriptions = new Set<string>();

  for (const edge of graphEdges(learnerGraph)) {
    const predicate = nonEmptyText(edge.predicate) ?? nonEmptyText(edge.relation_type);
    if (predicate !== "HAS_MISCONCEPTION" || nonEmptyText(edge.target) !== target.id) continue;
    const description = nonEmptyText(edge.natural_language_description);
    const id = nonEmptyText(edge.assertion_id) ?? nonEmptyText(edge.id);
    if (!description || !id) continue;
    const supersededBy = nonEmptyText(edge.superseded_by_assertion_id);
    const validTo = nonEmptyText(edge.valid_to);
    const active = edge.active === true || (!validTo && !supersededBy && edge.active !== false);
    const confidence = finiteScore(edge.confidence);
    const status = misconceptionStatus(edge, active, confidence);
    if (active) currentDescriptions.add(description);
    all.push({
      id,
      description,
      status,
      statusLabel: misconceptionStatusLabels[status],
      confidence,
      firstSeenAt: nonEmptyText(edge.valid_from) ?? nonEmptyText(edge.created_at),
      lastSeenAt: validTo ?? nonEmptyText(edge.valid_from) ?? nonEmptyText(edge.created_at),
      relatedEvidenceCount: countRelatedEvidence(
        evidence,
        description,
        nonEmptyText(edge.evidence_id),
      ),
      sourceTurnId: nonEmptyText(edge.source_turn_id),
      sourceRelationId: id,
      isActive: active,
      supersededByRelationId: supersededBy,
      recommendedAction: misconceptionRecommendation(status),
      source: "learner-graph",
    });
  }

  for (const [index, descriptionValue] of (targetItem?.critical_misconceptions ?? []).entries()) {
    const description = nonEmptyText(descriptionValue);
    if (!description || currentDescriptions.has(description)) continue;
    currentDescriptions.add(description);
    const status: MisconceptionStatus = "active";
    all.push({
      id: `model-${target.id}-${index}`,
      description,
      status,
      statusLabel: misconceptionStatusLabels[status],
      confidence: null,
      firstSeenAt: null,
      lastSeenAt: targetItem?.last_interaction_at ?? null,
      relatedEvidenceCount: countRelatedEvidence(evidence, description, null),
      sourceTurnId: null,
      sourceRelationId: null,
      isActive: true,
      supersededByRelationId: null,
      recommendedAction: misconceptionRecommendation(status),
      source: "learner-model",
    });
  }

  for (const item of evidence) {
    for (const [index, descriptionValue] of item.observed_misconceptions.entries()) {
      const description = nonEmptyText(descriptionValue);
      if (!description || all.some((entry) => entry.description === description)) continue;
      const isCurrent = currentDescriptions.has(description) ? true : null;
      const status: MisconceptionStatus = isCurrent ? "active" : "verify";
      all.push({
        id: `evidence-${item.id}-${index}`,
        description,
        status,
        statusLabel: misconceptionStatusLabels[status],
        confidence: finiteScore(item.grader_confidence),
        firstSeenAt: item.created_at,
        lastSeenAt: item.created_at,
        relatedEvidenceCount: countRelatedEvidence(evidence, description, item.id),
        sourceTurnId: item.turn_id,
        sourceRelationId: null,
        isActive: isCurrent,
        supersededByRelationId: null,
        recommendedAction: misconceptionRecommendation(status),
        source: "learner-evidence",
      });
    }
  }

  const current = all
    .filter((item) => item.isActive !== false)
    .sort((left, right) => sortTime(right.lastSeenAt) - sortTime(left.lastSeenAt));
  const history = all
    .filter((item) => item.isActive === false)
    .sort((left, right) => sortTime(right.lastSeenAt) - sortTime(left.lastSeenAt));
  return { current, history };
}

function evidenceDimensions(item: EvidenceItem): EvidenceDimension[] {
  const record = item as unknown as Record<string, unknown>;
  const dimensions = new Map<string, number>();
  const explicitDimensions = record.dimensions;
  if (isRecord(explicitDimensions)) {
    for (const [key, value] of Object.entries(explicitDimensions)) {
      const score = finiteScore(value);
      if (score !== null) dimensions.set(key.replace(/_score$/, ""), score);
    }
  }
  for (const [key, value] of Object.entries(record)) {
    if (!key.endsWith("_score") || key === "overall_score" || key === "mastery_score") {
      continue;
    }
    const score = finiteScore(value);
    if (score !== null) dimensions.set(key.slice(0, -6), score);
  }
  return [...dimensions.entries()].map(([key, score]) => ({
    key,
    label: dimensionLabels[key] ?? key.replaceAll("_", " "),
    score,
  }));
}

function currentEvidenceUse(
  graph: CytoscapeGraph | undefined,
  evidenceId: UUID,
): boolean | null {
  if (!graph) return null;
  return graphEdges(graph).some((edge) => {
    const predicate = nonEmptyText(edge.predicate) ?? nonEmptyText(edge.relation_type);
    const linkedEvidence = nonEmptyText(edge.evidence_id) ?? nonEmptyText(edge.target);
    const active = edge.active !== false && !nonEmptyText(edge.valid_to);
    return predicate === "HAS_MASTERY_EVIDENCE" && linkedEvidence === evidenceId && active;
  });
}

function answerSummary(record: Record<string, unknown>): string | null {
  const summary =
    nonEmptyText(record.raw_answer_summary) ??
    nonEmptyText(record.answer_summary) ??
    nonEmptyText(record.raw_answer);
  if (!summary) return null;
  return summary.length > 180 ? `${summary.slice(0, 177)}…` : summary;
}

export function adaptEvidence({
  target,
  learnerEvidence,
  learnerGraph,
}: EvidenceInput): EvidenceInsight[] {
  return (learnerEvidence?.items ?? [])
    .filter((item) => item.knowledge_point_id === target.id)
    .map((item) => {
      const record = item as unknown as Record<string, unknown>;
      const evidenceType = nonEmptyText(item.evidence_type) ?? "后端未提供";
      return {
        id: item.id,
        evidenceType,
        evidenceForm: evidenceTypeLabels[evidenceType] ?? evidenceType,
        cognitiveLevel: cognitiveLevel(item.cognitive_level),
        overallScore:
          finiteScore(record.overall_score) ?? finiteScore(record.score),
        dimensions: evidenceDimensions(item),
        confidence: finiteScore(item.grader_confidence),
        answerSummary: answerSummary(record),
        graderExplanation: nonEmptyText(item.grader_explanation),
        sessionId: nonEmptyText(item.session_id),
        turnId: nonEmptyText(item.turn_id),
        createdAt: nonEmptyText(item.created_at),
        isUsedForCurrentMastery: currentEvidenceUse(learnerGraph, item.id),
      } satisfies EvidenceInsight;
    })
    .sort((left, right) => sortTime(right.createdAt) - sortTime(left.createdAt));
}
