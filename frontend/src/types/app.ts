import type {
  DocumentRecord,
  Learner,
  RequestedMode,
  UUID,
  Workspace,
} from "./api";

export type ThemePreference = "light" | "dark" | "system";
export type GraphDensity = "comfortable" | "compact" | "dense";
export type ExplanationDetail = "concise" | "balanced" | "detailed";
export type HintStrength = "light" | "balanced" | "strong";
export type ReviewFrequency = "daily" | "twice-weekly" | "weekly";
export type FontSizePreference = "small" | "medium" | "large";
export type GraphLabelDensity = "minimal" | "balanced" | "detailed";
export type UiLocale = "zh-CN" | "en";

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
  uiLocale: UiLocale;
  theme: ThemePreference;
  reducedMotion: boolean;
  graphDensity: GraphDensity;
  defaultTeachingMode: RequestedMode;
  explanationDetail: ExplanationDetail;
  prioritizeExamples: boolean;
  hintStrength: HintStrength;
  reviewFrequency: ReviewFrequency;
  fontSize: FontSizePreference;
  graphLabelDensity: GraphLabelDensity;
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
