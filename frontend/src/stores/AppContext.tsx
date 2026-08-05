import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { apiClient } from "@/lib/api/client";
import type { DocumentRecord, Learner, UUID, Workspace } from "@/types/api";
import { recentDocumentFrom } from "@/types/app";
import { sanitizeApiBaseUrl } from "@/lib/utils";
import type {
  GraphDensity,
  LocalPreferences,
  PersistedAppState,
  RecentDocument,
  ThemePreference,
} from "@/types/app";

const STORAGE_KEY = "knowtier.app-state.v1";
const FALLBACK_API_BASE_URL =
  typeof import.meta.env.VITE_API_BASE_URL === "string"
    ? import.meta.env.VITE_API_BASE_URL
    : "/api";

interface AppContextValue extends PersistedAppState {
  setWorkspace: (workspace: Workspace | null) => void;
  setLearner: (learner: Learner | null) => void;
  rememberDocument: (document: DocumentRecord) => void;
  selectDocument: (documentId: UUID | null) => void;
  newSession: () => UUID;
  setSessionId: (sessionId: UUID) => void;
  setApiBaseUrl: (baseUrl: string) => void;
  setTheme: (theme: ThemePreference) => void;
  setReducedMotion: (reduced: boolean) => void;
  setGraphDensity: (density: GraphDensity) => void;
  clearLocalHistory: () => void;
}

const defaultPreferences: LocalPreferences = {
  apiBaseUrl: FALLBACK_API_BASE_URL,
  theme: "light",
  reducedMotion: false,
  graphDensity: "comfortable",
};

function freshState(): PersistedAppState {
  return {
    version: 1,
    currentWorkspace: null,
    currentLearner: null,
    currentDocumentId: null,
    sessionId: crypto.randomUUID(),
    recentWorkspaces: [],
    recentLearners: [],
    recentDocuments: [],
    preferences: defaultPreferences,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readState(): PersistedAppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      typeof parsed.sessionId !== "string"
    )
      return freshState();
    const state = parsed as unknown as PersistedAppState;
    return {
      ...freshState(),
      ...state,
      recentWorkspaces: Array.isArray(state.recentWorkspaces)
        ? state.recentWorkspaces.slice(0, 8)
        : [],
      recentLearners: Array.isArray(state.recentLearners)
        ? state.recentLearners.slice(0, 12)
        : [],
      recentDocuments: Array.isArray(state.recentDocuments)
        ? state.recentDocuments.slice(0, 30)
        : [],
      preferences: {
        ...defaultPreferences,
        ...(isRecord(state.preferences) ? state.preferences : {}),
        apiBaseUrl:
          sanitizeApiBaseUrl(
            isRecord(state.preferences)
              ? state.preferences.apiBaseUrl
              : defaultPreferences.apiBaseUrl,
          ) ?? defaultPreferences.apiBaseUrl,
      },
    };
  } catch {
    return freshState();
  }
}

function prependUnique<T extends { id: UUID }>(
  items: T[],
  next: T,
  limit: number,
): T[] {
  return [next, ...items.filter((item) => item.id !== next.id)].slice(0, limit);
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PersistedAppState>(() => {
    const initial = readState();
    apiClient.setWorkspaceId(initial.currentWorkspace?.id ?? null);
    apiClient.setBaseUrl(initial.preferences.apiBaseUrl);
    return initial;
  });

  useLayoutEffect(() => {
    apiClient.setWorkspaceId(state.currentWorkspace?.id ?? null);
    apiClient.setBaseUrl(state.preferences.apiBaseUrl);
  }, [state.currentWorkspace?.id, state.preferences.apiBaseUrl]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark =
        state.preferences.theme === "dark" ||
        (state.preferences.theme === "system" && media.matches);
      root.classList.toggle("dark", dark);
      root.dataset.reduceMotion = String(state.preferences.reducedMotion);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [state.preferences.reducedMotion, state.preferences.theme]);

  const setWorkspace = useCallback(
    (workspace: Workspace | null) =>
      setState((current) => ({
        ...current,
        currentWorkspace: workspace,
        currentLearner:
          workspace?.id === current.currentLearner?.workspace_id
            ? current.currentLearner
            : null,
        currentDocumentId: null,
        sessionId: crypto.randomUUID(),
        recentWorkspaces: workspace
          ? prependUnique(current.recentWorkspaces, workspace, 8)
          : current.recentWorkspaces,
      })),
    [],
  );

  const setLearner = useCallback(
    (learner: Learner | null) =>
      setState((current) => ({
        ...current,
        currentLearner: learner,
        sessionId:
          learner?.id === current.currentLearner?.id
            ? current.sessionId
            : crypto.randomUUID(),
        recentLearners: learner
          ? prependUnique(current.recentLearners, learner, 12)
          : current.recentLearners,
      })),
    [],
  );

  const rememberDocument = useCallback(
    (document: DocumentRecord) =>
      setState((current) => ({
        ...current,
        currentDocumentId: document.id,
        recentDocuments: prependUnique(
          current.recentDocuments,
          recentDocumentFrom(document),
          30,
        ),
      })),
    [],
  );

  const selectDocument = useCallback(
    (documentId: UUID | null) =>
      setState((current) => ({ ...current, currentDocumentId: documentId })),
    [],
  );
  const setSessionId = useCallback(
    (sessionId: UUID) => setState((current) => ({ ...current, sessionId })),
    [],
  );
  const newSession = useCallback(() => {
    const sessionId = crypto.randomUUID();
    setState((current) => ({ ...current, sessionId }));
    return sessionId;
  }, []);
  const updatePreferences = useCallback(
    (update: Partial<LocalPreferences>) =>
      setState((current) => ({
        ...current,
        preferences: { ...current.preferences, ...update },
      })),
    [],
  );
  const clearLocalHistory = useCallback(
    () =>
      setState((current) => ({
        ...freshState(),
        preferences: current.preferences,
      })),
    [],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      ...state,
      setWorkspace,
      setLearner,
      rememberDocument,
      selectDocument,
      newSession,
      setSessionId,
      setApiBaseUrl: (apiBaseUrl) =>
        updatePreferences({
          apiBaseUrl:
            sanitizeApiBaseUrl(apiBaseUrl) ?? defaultPreferences.apiBaseUrl,
        }),
      setTheme: (theme) => updatePreferences({ theme }),
      setReducedMotion: (reducedMotion) => updatePreferences({ reducedMotion }),
      setGraphDensity: (graphDensity) => updatePreferences({ graphDensity }),
      clearLocalHistory,
    }),
    [
      clearLocalHistory,
      newSession,
      rememberDocument,
      selectDocument,
      setLearner,
      setSessionId,
      setWorkspace,
      state,
      updatePreferences,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppStore(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useAppStore must be used inside AppProvider");
  return value;
}

export function documentsForWorkspace(
  documents: RecentDocument[],
  workspaceId: UUID | undefined,
): RecentDocument[] {
  return workspaceId
    ? documents.filter((document) => document.workspaceId === workspaceId)
    : [];
}
