export const queryKeys = {
  health: ["health"] as const,
  readiness: ["readiness"] as const,
  modelConfiguration: ["model-configuration"] as const,
  activeModel: (role: string) => ["active-model", role] as const,
  globalSearch: (workspaceId: string, learnerId: string, query: string) =>
    ["global-search", workspaceId, learnerId, query] as const,
  learner: (learnerId: string) => ["learner", learnerId] as const,
  model: (learnerId: string) => ["learner-model", learnerId] as const,
  evidence: (learnerId: string) => ["learner-evidence", learnerId] as const,
  learnerGraph: (learnerId: string) => ["learner-graph", learnerId] as const,
  learnerRevisions: (learnerId: string) =>
    ["learner-revisions", learnerId] as const,
  learningPath: (learnerId: string, targetId?: string) =>
    ["learning-path", learnerId, targetId ?? "auto"] as const,
  document: (documentId: string) => ["document", documentId] as const,
  documentChunks: (documentId: string) =>
    ["document-chunks", documentId] as const,
  extractedKnowledge: (documentId: string) =>
    ["extracted-knowledge", documentId] as const,
  manifest: (workspaceId: string) => ["manifest", workspaceId] as const,
  domainGraph: (workspaceId: string) => ["domain-graph", workspaceId] as const,
  domainSubgraph: (workspaceId: string, nodeId: string) =>
    ["domain-subgraph", workspaceId, nodeId] as const,
  domainNodeDetail: (workspaceId: string, nodeId: string) =>
    ["domain-node-detail", workspaceId, nodeId] as const,
  domainRevisions: (workspaceId: string) =>
    ["domain-revisions", workspaceId] as const,
};
