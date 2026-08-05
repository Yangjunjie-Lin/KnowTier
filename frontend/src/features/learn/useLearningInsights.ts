import {
  queryOptions,
  useQuery,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useMemo } from "react";
import {
  adaptEvidence,
  adaptMisconceptions,
  adaptPrerequisites,
  resolveLearningTarget,
  type LearningInsights,
  type LearningTargetReference,
  type NavigationLearningTarget,
} from "@/lib/learningInsights";
import { queryKeys } from "@/lib/queryKeys";
import { api } from "@/services/api";
import type {
  ChatResponse,
  CytoscapeGraph,
  EvidenceItem,
  GraphDetailResponse,
  LearnerModelResponse,
  UUID,
} from "@/types/api";

export interface LearningInsightPanelState {
  isLoading: boolean;
  isRefreshing: boolean;
  error: unknown;
  hasPartialError: boolean;
  lastUpdatedAt: string | null;
  retry: () => Promise<void>;
}

export interface UseLearningInsightsResult {
  insights: LearningInsights;
  panels: {
    prerequisites: LearningInsightPanelState;
    misconceptions: LearningInsightPanelState;
    evidence: LearningInsightPanelState;
  };
}

interface LearningInsightIds {
  workspaceId: UUID;
  learnerId: UUID;
  targetId: UUID;
}

interface UseLearningInsightsInput {
  workspaceId: UUID | null | undefined;
  learnerId: UUID | null | undefined;
  latestChatResponse: ChatResponse | null | undefined;
  navigationTarget: NavigationLearningTarget | null | undefined;
  synchronizingTargetId?: UUID | null;
}

const insightKeys = {
  model: (learnerId: UUID, targetId: UUID) =>
    [...queryKeys.model(learnerId), "learning-insights", targetId] as const,
  evidence: (learnerId: UUID, targetId: UUID) =>
    [...queryKeys.evidence(learnerId), "learning-insights", targetId] as const,
  graph: (learnerId: UUID, targetId: UUID) =>
    [...queryKeys.learnerGraph(learnerId), "learning-insights", targetId] as const,
};

export function learningModelInsightOptions(ids: LearningInsightIds) {
  return queryOptions({
    queryKey: insightKeys.model(ids.learnerId, ids.targetId),
    queryFn: ({ signal }) => api.getLearnerModel(ids.learnerId, signal),
    staleTime: 30_000,
    retry: false,
  });
}

export function learningEvidenceInsightOptions(ids: LearningInsightIds) {
  return queryOptions({
    queryKey: insightKeys.evidence(ids.learnerId, ids.targetId),
    queryFn: ({ signal }) => api.getLearnerEvidence(ids.learnerId, signal),
    staleTime: 30_000,
    retry: false,
  });
}

export function learningGraphInsightOptions(ids: LearningInsightIds) {
  return queryOptions({
    queryKey: insightKeys.graph(ids.learnerId, ids.targetId),
    queryFn: ({ signal }) => api.getLearnerGraph(ids.learnerId, signal),
    staleTime: 30_000,
    retry: false,
  });
}

export function domainDetailInsightOptions(ids: LearningInsightIds) {
  return queryOptions({
    queryKey: queryKeys.domainNodeDetail(ids.workspaceId, ids.targetId),
    queryFn: ({ signal }) =>
      api.getDomainDetail(ids.workspaceId, ids.targetId, signal),
    staleTime: 30_000,
    retry: false,
  });
}

export async function refreshLearningInsights(
  queryClient: QueryClient,
  ids: LearningInsightIds,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.model(ids.learnerId),
      refetchType: "none",
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.evidence(ids.learnerId),
      refetchType: "none",
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.learnerGraph(ids.learnerId),
      refetchType: "none",
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.domainNodeDetail(ids.workspaceId, ids.targetId),
      refetchType: "none",
    }),
  ]);
  await Promise.allSettled([
    queryClient.fetchQuery(learningModelInsightOptions(ids)),
    queryClient.fetchQuery(learningEvidenceInsightOptions(ids)),
    queryClient.fetchQuery(learningGraphInsightOptions(ids)),
    queryClient.fetchQuery(domainDetailInsightOptions(ids)),
  ]);
}

function updatedAt(
  queries: ReadonlyArray<UseQueryResult<unknown, Error>>,
): string | null {
  const timestamp = Math.max(
    0,
    ...queries.map((query) => query.dataUpdatedAt),
  );
  return timestamp ? new Date(timestamp).toISOString() : null;
}

function panelState(
  queries: ReadonlyArray<UseQueryResult<unknown, Error>>,
  isSynchronizing: boolean,
  hasUsableData: boolean,
): LearningInsightPanelState {
  const failed = queries.filter((query) => query.error !== null);
  const error = !hasUsableData && failed.length > 0 ? failed[0]?.error : null;
  return {
    isLoading: queries.some((query) => query.isPending && !query.isError),
    isRefreshing:
      isSynchronizing || queries.some((query) => query.isFetching && !query.isPending),
    error,
    hasPartialError: hasUsableData && failed.length > 0,
    lastUpdatedAt: updatedAt(queries),
    retry: async () => {
      await Promise.allSettled(queries.map((query) => query.refetch()));
    },
  };
}

function emptyInsights(
  target: LearningTargetReference | null,
  isRefreshing: boolean,
): LearningInsights {
  return {
    targetKnowledgePoint: target,
    prerequisites: [],
    prerequisiteStructureSource: "unavailable",
    misconceptions: { current: [], history: [] },
    evidence: [],
    lastUpdatedAt: null,
    isRefreshing,
    partialErrors: {},
  };
}

export function useLearningInsights({
  workspaceId,
  learnerId,
  latestChatResponse,
  navigationTarget,
  synchronizingTargetId = null,
}: UseLearningInsightsInput): UseLearningInsightsResult {
  const target = useMemo(
    () => resolveLearningTarget(latestChatResponse, navigationTarget),
    [latestChatResponse, navigationTarget],
  );
  const enabled = Boolean(workspaceId && learnerId && target?.id);
  const ids: LearningInsightIds = {
    workspaceId: workspaceId ?? "",
    learnerId: learnerId ?? "",
    targetId: target?.id ?? "",
  };
  const modelQuery = useQuery({
    ...learningModelInsightOptions(ids),
    enabled,
  });
  const evidenceQuery = useQuery({
    ...learningEvidenceInsightOptions(ids),
    enabled,
  });
  const graphQuery = useQuery({
    ...learningGraphInsightOptions(ids),
    enabled,
  });
  const domainDetailQuery = useQuery({
    ...domainDetailInsightOptions(ids),
    enabled,
  });
  const isSynchronizing = Boolean(
    target && synchronizingTargetId === target.id,
  );

  const partialErrors = useMemo(() => {
    const errors: LearningInsights["partialErrors"] = {};
    if (modelQuery.error) errors.learnerModel = modelQuery.error;
    if (evidenceQuery.error) errors.learnerEvidence = evidenceQuery.error;
    if (domainDetailQuery.error) errors.domainDetail = domainDetailQuery.error;
    if (graphQuery.error) errors.learnerGraph = graphQuery.error;
    return errors;
  }, [
    domainDetailQuery.error,
    evidenceQuery.error,
    graphQuery.error,
    modelQuery.error,
  ]);

  const insights = useMemo<LearningInsights>(() => {
    if (!target) return emptyInsights(null, false);
    const prerequisite = adaptPrerequisites({
      target,
      learnerModel: modelQuery.data,
      domainDetail: domainDetailQuery.data,
      learnerGraph: graphQuery.data,
    });
    const misconceptions = adaptMisconceptions({
      target,
      learnerModel: modelQuery.data,
      learnerEvidence: evidenceQuery.data,
      learnerGraph: graphQuery.data,
    });
    const evidence = adaptEvidence({
      target,
      learnerEvidence: evidenceQuery.data,
      learnerGraph: graphQuery.data,
    });
    const allQueries: Array<UseQueryResult<unknown, Error>> = [
      modelQuery,
      evidenceQuery,
      graphQuery,
      domainDetailQuery,
    ];
    return {
      targetKnowledgePoint: target,
      prerequisites: prerequisite.items,
      prerequisiteStructureSource: prerequisite.structureSource,
      misconceptions,
      evidence,
      lastUpdatedAt: updatedAt(allQueries),
      isRefreshing:
        isSynchronizing || allQueries.some((query) => query.isFetching),
      partialErrors,
    };
  }, [
    domainDetailQuery,
    evidenceQuery,
    graphQuery,
    isSynchronizing,
    modelQuery,
    partialErrors,
    target,
  ]);

  if (!enabled) {
    const waitingState: LearningInsightPanelState = {
      isLoading: false,
      isRefreshing: false,
      error: null,
      hasPartialError: false,
      lastUpdatedAt: null,
      retry: () => Promise.resolve(),
    };
    return {
      insights: emptyInsights(target, false),
      panels: {
        prerequisites: waitingState,
        misconceptions: waitingState,
        evidence: waitingState,
      },
    };
  }

  return {
    insights,
    panels: {
      prerequisites: panelState(
        [modelQuery, domainDetailQuery, graphQuery],
        isSynchronizing,
        Boolean(modelQuery.data || domainDetailQuery.data),
      ),
      misconceptions: panelState(
        [modelQuery, evidenceQuery, graphQuery],
        isSynchronizing,
        Boolean(modelQuery.data || evidenceQuery.data || graphQuery.data),
      ),
      evidence: panelState(
        [evidenceQuery, graphQuery],
        isSynchronizing,
        Boolean(evidenceQuery.data),
      ),
    },
  };
}

export type LearningModelInsightData = LearnerModelResponse;
export type LearningEvidenceInsightData = { learner_id: UUID; items: EvidenceItem[] };
export type LearningGraphInsightData = CytoscapeGraph;
export type DomainDetailInsightData = GraphDetailResponse;
