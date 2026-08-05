import type { DocumentRecord, Learner, UUID, Workspace } from "./api";

export type ThemePreference = "light" | "dark" | "system";
export type GraphDensity = "comfortable" | "compact" | "dense";

export interface RecentDocument {
  id: UUID;
  workspaceId: UUID;
  filename: string;
  mimeType: string;
  status: string;
  createdAt: string;
}

export interface LocalPreferences {
  apiBaseUrl: string;
  theme: ThemePreference;
  reducedMotion: boolean;
  graphDensity: GraphDensity;
}

export interface PersistedAppState {
  version: 1;
  currentWorkspace: Workspace | null;
  currentLearner: Learner | null;
  currentDocumentId: UUID | null;
  sessionId: UUID;
  recentWorkspaces: Workspace[];
  recentLearners: Learner[];
  recentDocuments: RecentDocument[];
  preferences: LocalPreferences;
}

export function recentDocumentFrom(record: DocumentRecord): RecentDocument {
  return {
    id: record.id,
    workspaceId: record.workspace_id,
    filename: record.filename,
    mimeType: record.mime_type,
    status: record.status,
    createdAt: record.created_at,
  };
}
