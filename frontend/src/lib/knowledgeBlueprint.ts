import {
  asRecord,
  firstNumber,
  firstText,
  recordArray,
  textArray,
  textValue,
  uniqueStrings,
  type UnknownRecord,
} from "./dataAdapter";
import { isUuid } from "./utils";
import type { UiLocale } from "@/types/app";

export interface BlueprintTheory {
  candidateKey: string;
  name: string;
  description: string | null;
  confidence: number | null;
  sourceSpanIds: string[];
}

export interface BlueprintStage {
  cognitiveLevel: number | null;
  learningObjective: string | null;
  teachingStrategy: string | null;
  prerequisites: string[];
  mustCover: string[];
  diagnosticQuestion: string | null;
  masteryCriteria: string[];
  promotionRequirements: string[];
  remediationPolicy: string | null;
}

export interface BlueprintExample {
  candidateKey: string;
  knowledgePointCandidateId: string | null;
  content: string;
  boundaryExplained: string | null;
  sourceSpanIds: string[];
}

export interface BlueprintMisconception {
  candidateKey: string;
  knowledgePointCandidateId: string | null;
  statement: string;
  correction: string | null;
  sourceSpanIds: string[];
}

export interface BlueprintAssessment {
  candidateKey: string;
  knowledgePointCandidateId: string | null;
  cognitiveLevel: number | null;
  question: string;
  successCriteria: string[];
  sourceSpanIds: string[];
}

export interface BlueprintRelation {
  subjectCandidateId: string;
  predicate: string;
  objectCandidateId: string;
  description: string;
  confidence: number | null;
  sourceSpanIds: string[];
}

export interface BlueprintAmbiguity {
  description: string;
  candidateKeys: string[];
  sourceSpanIds: string[];
}

export interface BlueprintKnowledgePoint {
  candidateKey: string;
  name: string;
  plainDefinition: string | null;
  formalDefinition: string | null;
  importance: number | null;
  difficulty: number | null;
  prerequisiteKeys: string[];
  prerequisites: Array<{ key: string; name: string }>;
  mustCover: string[];
  commonConfusions: string[];
  applicability: string[];
  limitations: string[];
  sourceSpanIds: string[];
  confidence: number | null;
  stages: BlueprintStage[];
  methods: string[];
  examples: BlueprintExample[];
  counterexamples: BlueprintExample[];
  misconceptions: BlueprintMisconception[];
  assessments: BlueprintAssessment[];
  graphNodeId: string | null;
  graphLinkReason: string | null;
}

export interface KnowledgeBlueprintViewModel {
  title: string;
  domain: string | null;
  theories: BlueprintTheory[];
  knowledgePoints: BlueprintKnowledgePoint[];
  relations: BlueprintRelation[];
  examples: BlueprintExample[];
  counterexamples: BlueprintExample[];
  misconceptions: BlueprintMisconception[];
  assessments: BlueprintAssessment[];
  ambiguities: BlueprintAmbiguity[];
  sourceSpanIds: string[];
  raw: UnknownRecord;
}

export function adaptKnowledgeBlueprint(
  value: unknown,
  locale: UiLocale = "zh-CN",
): KnowledgeBlueprintViewModel | null {
  const raw = asRecord(value);
  if (!raw) return null;

  const theories = recordArray(raw.theories).map((item, index) => adaptTheory(item, index, locale));
  const examples = recordArray(raw.examples).map((item) =>
    adaptExample(item, false, locale),
  );
  const counterexamples = recordArray(raw.counterexamples).map((item) =>
    adaptExample(item, true, locale),
  );
  const misconceptions = recordArray(raw.misconceptions).map((item) => adaptMisconception(item, locale));
  const assessments = recordArray(raw.questions).map((item) => adaptAssessment(item, locale));
  const pointRows = recordArray(raw.knowledge_points);
  const pointNames = new Map(
    pointRows.map((item, index) => {
      const key = firstText(item, "candidate_key") ?? `knowledge-point-${index + 1}`;
      return [key, firstText(item, "canonical_name", "name") ?? (locale === "en" ? `Unnamed knowledge point ${index + 1}` : `未命名知识点 ${index + 1}`)];
    }),
  );
  const knowledgePoints = pointRows.map((item, index) => {
    const candidateKey =
      firstText(item, "candidate_key") ?? `knowledge-point-${index + 1}`;
    const explicitNodeId = firstText(item, "graph_node_id", "node_id");
    const graphNodeId = explicitNodeId && isUuid(explicitNodeId) ? explicitNodeId : null;
    return {
      candidateKey,
      name: firstText(item, "canonical_name", "name") ?? (locale === "en" ? `Unnamed knowledge point ${index + 1}` : `未命名知识点 ${index + 1}`),
      plainDefinition: firstText(item, "plain_definition", "plain_language_definition"),
      formalDefinition: firstText(item, "formal_definition"),
      importance: firstNumber(item, "importance"),
      difficulty: firstNumber(item, "difficulty"),
      prerequisiteKeys: textArray(item.prerequisites),
      prerequisites: textArray(item.prerequisites).map((key) => ({
        key,
        name: pointNames.get(key) ?? key,
      })),
      mustCover: textArray(item.must_cover),
      commonConfusions: textArray(item.common_confusions),
      applicability: textArray(item.applicability),
      limitations: textArray(item.limitations),
      sourceSpanIds: textArray(item.source_span_ids),
      confidence: firstNumber(item, "confidence"),
      stages: recordArray(item.six_level_plan).map(adaptStage),
      methods: uniqueStrings(
        recordArray(item.six_level_plan)
          .map((stage) => firstText(stage, "teaching_strategy"))
          .filter((method): method is string => method !== null),
      ),
      examples: examples.filter(
        (entry) => entry.knowledgePointCandidateId === candidateKey,
      ),
      counterexamples: counterexamples.filter(
        (entry) => entry.knowledgePointCandidateId === candidateKey,
      ),
      misconceptions: misconceptions.filter(
        (entry) => entry.knowledgePointCandidateId === candidateKey,
      ),
      assessments: assessments.filter(
        (entry) => entry.knowledgePointCandidateId === candidateKey,
      ),
      graphNodeId,
      graphLinkReason: graphNodeId
        ? null
        : explicitNodeId
          ? locale === "en" ? "The linked graph node is unavailable." : "关联的图谱节点暂不可用。"
          : locale === "en" ? "This candidate has not been published to the domain map yet." : "该候选知识点尚未发布到领域图谱。",
    } satisfies BlueprintKnowledgePoint;
  });

  const relations = recordArray(raw.relations).map((item) => adaptRelation(item, locale));
  const ambiguities = [
    ...recordArray(raw.unresolved_ambiguities),
    ...recordArray(raw.conflicts),
  ].map((item) => adaptAmbiguity(item, locale));
  const sourceSpanIds = uniqueStrings([
    ...theories.flatMap((item) => item.sourceSpanIds),
    ...knowledgePoints.flatMap((item) => item.sourceSpanIds),
    ...relations.flatMap((item) => item.sourceSpanIds),
    ...examples.flatMap((item) => item.sourceSpanIds),
    ...counterexamples.flatMap((item) => item.sourceSpanIds),
    ...misconceptions.flatMap((item) => item.sourceSpanIds),
    ...assessments.flatMap((item) => item.sourceSpanIds),
    ...ambiguities.flatMap((item) => item.sourceSpanIds),
  ]);

  return {
    title: firstText(raw, "title") ?? (locale === "en" ? "Untitled knowledge blueprint" : "未命名知识蓝图"),
    domain: firstText(raw, "domain"),
    theories,
    knowledgePoints,
    relations,
    examples,
    counterexamples,
    misconceptions,
    assessments,
    ambiguities,
    sourceSpanIds,
    raw,
  };
}

function adaptTheory(item: UnknownRecord, index = 0, locale: UiLocale = "zh-CN"): BlueprintTheory {
  const key = firstText(item, "candidate_key") ?? `theory-${index + 1}`;
  return {
    candidateKey: key,
    name: firstText(item, "name") ?? (locale === "en" ? `Unnamed theory ${index + 1}` : `未命名理论 ${index + 1}`),
    description: firstText(item, "description"),
    confidence: firstNumber(item, "confidence"),
    sourceSpanIds: textArray(item.source_span_ids),
  };
}

function adaptStage(item: UnknownRecord): BlueprintStage {
  return {
    cognitiveLevel: firstNumber(item, "cognitive_level"),
    learningObjective: firstText(item, "learning_objective"),
    teachingStrategy: firstText(item, "teaching_strategy"),
    prerequisites: textArray(item.required_prerequisites),
    mustCover: textArray(item.must_cover),
    diagnosticQuestion: firstText(item, "diagnostic_question"),
    masteryCriteria: textArray(item.mastery_criteria),
    promotionRequirements: textArray(item.promotion_requirements),
    remediationPolicy: firstText(item, "remediation_policy"),
  };
}

function adaptExample(item: UnknownRecord, counterexample: boolean, locale: UiLocale): BlueprintExample {
  const key = firstText(item, "candidate_key") ?? "未命名候选";
  return {
    candidateKey: key,
    knowledgePointCandidateId: firstText(item, "knowledge_point_candidate_id"),
    content: firstText(item, "content") ?? (locale === "en" ? "No content available" : "暂无内容"),
    boundaryExplained: counterexample
      ? firstText(item, "boundary_explained")
      : null,
    sourceSpanIds: textArray(item.source_span_ids),
  };
}

function adaptMisconception(item: UnknownRecord, locale: UiLocale): BlueprintMisconception {
  const key = firstText(item, "candidate_key") ?? "未命名候选";
  return {
    candidateKey: key,
    knowledgePointCandidateId: firstText(item, "knowledge_point_candidate_id"),
    statement: firstText(item, "statement") ?? (locale === "en" ? "No misconception description is available" : "暂无误解描述"),
    correction: firstText(item, "correction"),
    sourceSpanIds: textArray(item.source_span_ids),
  };
}

function adaptAssessment(item: UnknownRecord, locale: UiLocale): BlueprintAssessment {
  const key = firstText(item, "candidate_key") ?? "未命名检测";
  return {
    candidateKey: key,
    knowledgePointCandidateId: firstText(item, "knowledge_point_candidate_id"),
    cognitiveLevel: firstNumber(item, "cognitive_level"),
    question: firstText(item, "question") ?? (locale === "en" ? "No mastery-check question is available" : "暂无检测问题"),
    successCriteria: textArray(item.success_criteria),
    sourceSpanIds: textArray(item.source_span_ids),
  };
}

function adaptRelation(item: UnknownRecord, locale: UiLocale): BlueprintRelation {
  const subject = firstText(item, "subject_candidate_id") ?? "未知主体";
  const object = firstText(item, "object_candidate_id") ?? "未知客体";
  return {
    subjectCandidateId: subject,
    predicate: firstText(item, "predicate") ?? "未知关系",
    objectCandidateId: object,
    description:
      firstText(item, "natural_language_description", "description") ??
      (locale === "en" ? "A knowledge relationship was extracted." : "已抽取一条知识关系。"),
    confidence: firstNumber(item, "confidence"),
    sourceSpanIds: textArray(item.source_span_ids),
  };
}

function adaptAmbiguity(item: UnknownRecord, locale: UiLocale): BlueprintAmbiguity {
  return {
    description:
      firstText(item, "description", "reason") ?? (locale === "en" ? "An ambiguity requires review" : "有一处歧义需要复核"),
    candidateKeys: textArray(item.candidate_keys),
    sourceSpanIds: textArray(item.source_span_ids),
  };
}

export function blueprintPointByKey(
  blueprint: KnowledgeBlueprintViewModel,
  candidateKey: string,
): BlueprintKnowledgePoint | null {
  return (
    blueprint.knowledgePoints.find((item) => item.candidateKey === candidateKey) ??
    null
  );
}

export function hasBlueprintContent(value: unknown): boolean {
  const blueprint = adaptKnowledgeBlueprint(value);
  return Boolean(
    blueprint &&
      (textValue(blueprint.title) ||
        blueprint.theories.length ||
        blueprint.knowledgePoints.length),
  );
}
