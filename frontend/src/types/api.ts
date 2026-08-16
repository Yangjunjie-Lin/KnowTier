export type UUID = string;

export type CognitiveLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type RequestedMode =
  | "learn"
  | "review"
  | "practice"
  | "exam"
  | "research";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface Workspace {
  id: UUID;
  name: string;
  slug: string;
  default_language: string;
  created_at: string;
}

export interface PageResponse<T> {
  items: T[];
  limit: number;
  offset: number;
  next_offset: number | null;
}

export type WorkspaceListResponse = PageResponse<Workspace>;

export interface Learner {
  id: UUID;
  workspace_id: UUID;
  display_name: string;
  language: string;
  created_at: string;
}

export interface LearnerListResponse extends PageResponse<Learner> {
  workspace_id: UUID;
}

export interface DocumentRecord {
  id: UUID;
  workspace_id: UUID;
  filename: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  status: string;
  page_count: number | null;
  warnings: string[];
  created_at: string;
}

export interface DocumentListResponse extends PageResponse<DocumentRecord> {
  workspace_id: UUID;
}

export interface IngestionReport {
  document_id: UUID;
  parser: string;
  page_count: number;
  chunk_count: number;
  knowledge_point_count: number;
  assertion_count: number;
  warning_count: number;
  graph_revision_id: UUID | null;
  parser_chain: string[];
  ocr_used: boolean;
  vision_used: boolean;
  detected_language: string | null;
  low_confidence_blocks: number;
}

export interface ChatRequest {
  workspace_id: UUID;
  learner_id: UUID;
  session_id: UUID;
  client_request_id?: UUID | null;
  message: string;
  attachment_ids: UUID[];
  requested_mode: RequestedMode;
}

export interface ChatResponse {
  turn_id: UUID;
  response: string;
  target_knowledge_point: { id: UUID; name: string };
  cognitive_level: CognitiveLevel;
  teaching_action: string;
  assessment: { type: string; question: string };
  learner_update: {
    decision: string;
    reason: string;
    current_level: CognitiveLevel;
    mastery_score: number;
    confidence: number;
  };
  graph_update: {
    revision_id: UUID | null;
    nodes_added: number;
    assertions_added: number;
    assertions_superseded: number;
  };
  learner_graph_update: {
    revision_id: UUID;
    assertions_added: number;
    assertions_superseded: number;
  } | null;
  tool_usage: {
    enabled: boolean;
    steps: number;
    tools: string[];
    fallback: boolean;
  } | null;
  model_fallback?: boolean;
  sources: JsonObject[];
}

export interface ConversationHistoryUserTurn {
  id: UUID;
  role: "user";
  content: string;
  attachment_ids: UUID[];
  created_at: string;
}

export interface ConversationHistoryAssistantTurn {
  id: UUID;
  role: "assistant";
  response: ChatResponse;
  created_at: string;
}

export type ConversationHistoryItem =
  | ConversationHistoryUserTurn
  | ConversationHistoryAssistantTurn;

export interface ConversationHistoryResponse {
  workspace_id: UUID;
  learner_id: UUID;
  session_id: UUID;
  turn_limit: number;
  truncated: boolean;
  items: ConversationHistoryItem[];
}

export interface LearnerModelItem {
  knowledge_point_id: UUID;
  knowledge_point: string;
  current_level: CognitiveLevel;
  mastery_score: number;
  confidence: number;
  evidence_count: number;
  critical_misconceptions: string[];
  prerequisites: PrerequisiteState[];
  all_prerequisites_mastered: boolean;
  prerequisite_status: "mastered" | "not_mastered" | "none";
  last_interaction_at: string | null;
  next_review_at: string | null;
  recommended_action: string;
}

export interface PrerequisiteState {
  knowledge_point_id: UUID;
  knowledge_point: string;
  mastery_score: number;
  current_level: CognitiveLevel;
  status: "mastered" | "not_mastered";
}

export interface LearnerModelResponse {
  learner_id: UUID;
  workspace_id: UUID;
  items: LearnerModelItem[];
}

export interface EvidenceItem {
  id: UUID;
  knowledge_point_id: UUID;
  session_id: UUID;
  turn_id: UUID;
  evidence_type: string;
  cognitive_level: CognitiveLevel;
  correctness_score: number;
  reasoning_score: number;
  independence_score: number;
  transfer_score: number;
  grader_confidence: number;
  observed_misconceptions: string[];
  grader_explanation: string;
  created_at: string;
}

export interface RevisionSummary {
  id: UUID;
  workspace_id: UUID;
  sequence_number: number;
  parent_revision_id: UUID | null;
  status: string;
  projection_status: string;
  manifest: JsonObject | null;
  summary: JsonObject;
  created_by: string;
  model_run_id: UUID | null;
  created_at: string;
  projected_at: string | null;
}

export interface LearnerRevision {
  id: UUID;
  workspace_id: UUID;
  learner_id: UUID;
  session_id: UUID;
  turn_id: UUID;
  sequence_number: number;
  parent_revision_id: UUID | null;
  change_summary: JsonObject;
  assertions_added: number;
  assertions_superseded: number;
  created_at: string;
  assertions?: LearnerAssertion[];
  events?: JsonObject[];
}

export interface LearnerAssertion {
  id: UUID;
  workspace_id: UUID;
  learner_id: UUID;
  subject_id: UUID;
  predicate: string;
  relation_type: string;
  object_id: UUID;
  natural_language_description: string;
  confidence: number;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
  superseded_at: string | null;
  source_turn_id: UUID | null;
  mastery_evidence_id: UUID | null;
  evidence_id: UUID | null;
  learner_graph_revision_id: UUID;
  supersedes_assertion_id: UUID | null;
  is_active: boolean;
}

export interface GraphNodeData {
  id: UUID;
  type: string;
  label?: string;
  entity_type?: string;
  epistemic_status?: string;
  source_confidence?: number;
  source_count?: number;
  model_run_id?: UUID | null;
  properties?: JsonObject;
  [key: string]: JsonValue | undefined;
}

export interface GraphEdgeData {
  id: UUID;
  source: UUID;
  target: UUID;
  assertion_id: UUID;
  relation_type?: string;
  predicate?: string;
  natural_language_description?: string;
  confidence?: number;
  source_count?: number;
  graph_revision_id?: UUID;
  learner_graph_revision_id?: UUID;
  active?: boolean;
  [key: string]: JsonValue | undefined;
}

export interface CytoscapeGraph {
  elements: {
    nodes: Array<{ data: GraphNodeData }>;
    edges: Array<{ data: GraphEdgeData }>;
  };
  meta: JsonObject;
}

export interface GraphManifest {
  workspace_id: UUID;
  revision_id: UUID | null;
  ontology: {
    entity_types: string[];
    relation_types: string[];
    knowledge_point_count?: number;
    assertion_count?: number;
  };
  top_level_domains: string[];
  theories: string[];
  knowledge_point_count: number;
  assertion_count: number;
  source_count: number;
  major_clusters: Array<{ name: string; node_count: number }>;
  node_count?: number;
  updated_at?: string | null;
}

export interface DocumentChunk {
  id: UUID;
  sequence: number;
  text: string;
  page_start: number | null;
  page_end: number | null;
  heading_path: string[];
  token_count: number;
}

export interface ExtractedKnowledge {
  document_id: UUID;
  blueprint: JsonObject | null;
}

export interface ApiHealth {
  status?: string;
  ready?: boolean;
  checks?: Record<string, string | boolean | JsonObject>;
  [key: string]: JsonValue | undefined;
}

export interface LearningPathData {
  learner_id?: UUID;
  knowledge_point_ids: UUID[];
  learner_graph_revision_id?: UUID | null;
  graph_revision_id?: UUID | null;
  learner_states?: JsonObject[];
  nodes?: JsonObject[];
  assertions?: JsonObject[];
}

export interface LearningPathEnvelope {
  workspace_id: UUID;
  graph_revision_id: UUID | null;
  data: LearningPathData;
}

export type LearningPathResponse = LearningPathData | LearningPathEnvelope;

export interface GraphQueryEnvelope<T extends JsonObject = JsonObject> {
  workspace_id: UUID;
  graph_revision_id: UUID | null;
  data: T;
}

export interface GraphDetailResponse {
  data: JsonObject;
  workspace_id?: UUID;
  graph_revision_id?: UUID | null;
}

export type ModelProviderKind =
  | "mock"
  | "siliconflow"
  | "custom_openai_compatible";
export type CredentialStorage = "session" | "os_keyring";
export type ModelConnectionStatus = "untested" | "connected" | "error";

export interface RoleModels {
  teacher: string;
  extractor: string;
  grader: string;
  graph: string;
  vision: string;
  embedding: string;
}

export interface ModelProfile {
  id: UUID;
  name: string;
  provider: ModelProviderKind;
  base_url: string | null;
  allow_local: boolean;
  credential_storage: CredentialStorage;
  models: RoleModels;
  timeout_seconds: number;
  max_retries: number;
  temperature: number;
  max_tokens: number;
  active: boolean;
  connection_status: ModelConnectionStatus;
  last_tested_at: string | null;
  error_summary: string | null;
  updated_at: string;
  credential_present: boolean;
  credential_masked: string | null;
}

export interface ModelProfileInput {
  name: string;
  provider: ModelProviderKind;
  base_url?: string | null;
  allow_local: boolean;
  credential_storage: CredentialStorage;
  models: RoleModels;
  timeout_seconds: number;
  max_retries: number;
  temperature: number;
  max_tokens: number;
  api_key?: string;
}

export interface ModelConfigurationSnapshot {
  profiles: ModelProfile[];
  active_profile_id: UUID | null;
}

export interface ModelDiscoveryResult {
  profile_id: UUID;
  provider: ModelProviderKind;
  models: string[];
  tested_at: string;
}

export type ModelRoleName =
  | "teacher"
  | "extractor"
  | "grader"
  | "graph"
  | "vision"
  | "embedding";

export interface ActiveModel {
  role: ModelRoleName;
  provider: string;
  model: string;
  profile_id: UUID | null;
  profile_name: string;
}

export type GlobalSearchResultKind =
  | "knowledge"
  | "material"
  | "material_content"
  | "learner_state";

export interface GlobalSearchResult {
  kind: GlobalSearchResultKind;
  id: UUID;
  title: string;
  description: string;
  path: string;
  score: number;
  metadata: JsonObject;
}

export interface GlobalSearchResponse {
  query: string;
  items: GlobalSearchResult[];
  truncated: boolean;
}
