import { apiClient } from "@/lib/api/client";
import type {
  ApiHealth,
  ChatRequest,
  ChatResponse,
  CytoscapeGraph,
  DocumentChunk,
  DocumentRecord,
  ExtractedKnowledge,
  EvidenceItem,
  GraphDetailResponse,
  GraphManifest,
  GraphQueryEnvelope,
  IngestionReport,
  JsonValue,
  Learner,
  LearnerModelResponse,
  LearnerRevision,
  LearningPathData,
  LearningPathResponse,
  RevisionSummary,
  UUID,
  Workspace,
} from "@/types/api";

export const api = {
  health: (signal?: AbortSignal) =>
    apiClient.get<ApiHealth>("/health", {
      workspaceScoped: false,
      signal,
    }),
  readiness: (signal?: AbortSignal) =>
    apiClient.get<ApiHealth>("/ready", {
      workspaceScoped: false,
      retries: 1,
      acceptedStatuses: [503],
      signal,
    }),
  createWorkspace: (input: {
    name: string;
    slug: string;
    default_language: string;
    provisioningToken?: string;
  }) => {
    const headers = input.provisioningToken
      ? { "X-Workspace-Provisioning-Token": input.provisioningToken }
      : undefined;
    return apiClient.post<Workspace>(
      "/v1/workspaces",
      {
        name: input.name,
        slug: input.slug,
        default_language: input.default_language,
      },
      { workspaceScoped: false, headers },
    );
  },
  createLearner: (input: {
    workspace_id: UUID;
    display_name: string;
    external_id?: string;
    language: string;
  }) => apiClient.post<Learner>("/v1/learners", input),
  getLearner: (learnerId: UUID, signal?: AbortSignal) =>
    apiClient.get<Learner>(`/v1/learners/${learnerId}`, { signal }),
  uploadDocument: (workspaceId: UUID, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return apiClient.post<DocumentRecord>(
      `/v1/workspaces/${workspaceId}/documents`,
      body,
      { timeoutMs: 120_000 },
    );
  },
  getDocument: (documentId: UUID, signal?: AbortSignal) =>
    apiClient.get<DocumentRecord>(`/v1/documents/${documentId}`, { signal }),
  ingestDocument: (documentId: UUID) =>
    apiClient.post<IngestionReport>(
      `/v1/documents/${documentId}/ingest`,
      undefined,
      { timeoutMs: 10 * 60_000, retries: 0 },
    ),
  getDocumentChunks: (documentId: UUID, signal?: AbortSignal) =>
    apiClient.get<{ document_id: UUID; items: DocumentChunk[] }>(
      `/v1/documents/${documentId}/chunks`,
      { signal },
    ),
  getExtractedKnowledge: (documentId: UUID, signal?: AbortSignal) =>
    apiClient.get<ExtractedKnowledge>(
      `/v1/documents/${documentId}/extracted-knowledge`,
      { signal },
    ),
  chat: (input: ChatRequest) =>
    apiClient.post<ChatResponse>("/v1/chat", input, {
      timeoutMs: 120_000,
      retries: 0,
    }),
  getManifest: (workspaceId: UUID, signal?: AbortSignal) =>
    apiClient.get<
      GraphQueryEnvelope<GraphManifest & { [key: string]: JsonValue }>
    >(`/v1/graph/manifest?workspace_id=${encodeURIComponent(workspaceId)}`, {
      signal,
    }),
  getDomainGraph: (workspaceId: UUID, signal?: AbortSignal) =>
    apiClient.get<CytoscapeGraph>(
      `/v1/graph/export?workspace_id=${encodeURIComponent(workspaceId)}&format=cytoscape`,
      { signal },
    ),
  getDomainDetail: (
    workspaceId: UUID,
    nodeId: UUID,
    signal?: AbortSignal,
  ) =>
    apiClient.get<GraphDetailResponse>(
      `/v1/graph/nodes/${nodeId}?workspace_id=${encodeURIComponent(workspaceId)}`,
      { signal },
    ),
  getAssertionDetail: (
    workspaceId: UUID,
    assertionId: UUID,
    signal?: AbortSignal,
  ) =>
    apiClient.get<GraphDetailResponse>(
      `/v1/graph/assertions/${assertionId}?workspace_id=${encodeURIComponent(workspaceId)}`,
      { signal },
    ),
  getDomainSubgraph: (
    workspaceId: UUID,
    nodeId: UUID,
    maxDepth = 2,
    maxNodes = 50,
    signal?: AbortSignal,
  ) =>
    apiClient.get<GraphQueryEnvelope>(
      `/v1/graph/subgraph?workspace_id=${encodeURIComponent(workspaceId)}&node_id=${nodeId}&max_depth=${maxDepth}&max_nodes=${maxNodes}`,
      { signal },
    ),
  listDomainRevisions: (workspaceId: UUID, signal?: AbortSignal) =>
    apiClient.get<{ workspace_id: UUID; items: RevisionSummary[] }>(
      `/v1/graph/revisions?workspace_id=${encodeURIComponent(workspaceId)}`,
      { signal },
    ),
  getDomainRevision: (
    workspaceId: UUID,
    revisionId: UUID,
    signal?: AbortSignal,
  ) =>
    apiClient.get<RevisionSummary>(
      `/v1/graph/revisions/${revisionId}?workspace_id=${encodeURIComponent(workspaceId)}`,
      { signal },
    ),
  getLearnerModel: (learnerId: UUID, signal?: AbortSignal) =>
    apiClient.get<LearnerModelResponse>(`/v1/learners/${learnerId}/model`, {
      signal,
    }),
  getLearnerEvidence: (learnerId: UUID, signal?: AbortSignal) =>
    apiClient.get<{ learner_id: UUID; items: EvidenceItem[] }>(
      `/v1/learners/${learnerId}/evidence`,
      { signal },
    ),
  getLearnerGraph: (learnerId: UUID, signal?: AbortSignal) =>
    apiClient.get<CytoscapeGraph>(
      `/v1/learners/${learnerId}/knowledge-graph`,
      { signal },
    ),
  getLearnerNodeDetail: (
    learnerId: UUID,
    nodeId: UUID,
    signal?: AbortSignal,
  ) =>
    apiClient.get<GraphDetailResponse>(
      `/v1/learners/${learnerId}/graph/nodes/${nodeId}`,
      { signal },
    ),
  getLearnerAssertionDetail: (
    learnerId: UUID,
    assertionId: UUID,
    signal?: AbortSignal,
  ) =>
    apiClient.get<GraphDetailResponse>(
      `/v1/learners/${learnerId}/graph/assertions/${assertionId}`,
      { signal },
    ),
  listLearnerRevisions: (learnerId: UUID, signal?: AbortSignal) =>
    apiClient.get<{ learner_id: UUID; items: LearnerRevision[] }>(
      `/v1/learners/${learnerId}/graph/revisions`,
      { signal },
    ),
  getLearnerRevision: (
    learnerId: UUID,
    revisionId: UUID,
    signal?: AbortSignal,
  ) =>
    apiClient.get<LearnerRevision>(
      `/v1/learners/${learnerId}/graph/revisions/${revisionId}`,
      { signal },
    ),
  getLearningPath: async (
    learnerId: UUID,
    targetKnowledgePointId?: UUID,
    signal?: AbortSignal,
  ): Promise<LearningPathData> => {
    const response = await apiClient.get<LearningPathResponse>(
      `/v1/learners/${learnerId}/learning-path${targetKnowledgePointId ? `?target_knowledge_point_id=${encodeURIComponent(targetKnowledgePointId)}` : ""}`,
      { signal },
    );
    return "data" in response
      ? {
          ...response.data,
          graph_revision_id:
            response.data.graph_revision_id ?? response.graph_revision_id,
        }
      : response;
  },
  downloadLearnerModelCsv: (learnerId: UUID) =>
    apiClient.download(`/v1/learners/${learnerId}/model.csv`),
  downloadGraph: (
    workspaceId: UUID,
    format: "cytoscape" | "jsonld" | "turtle",
  ) =>
    apiClient.download(
      `/v1/graph/export?workspace_id=${encodeURIComponent(workspaceId)}&format=${format}`,
    ),
};
