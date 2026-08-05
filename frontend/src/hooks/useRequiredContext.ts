import { useAppStore } from "@/stores/AppContext";

export function useRequiredContext() {
  const { currentWorkspace, currentLearner, sessionId } = useAppStore();
  if (!currentWorkspace || !currentLearner)
    throw new Error("Workspace and learner are required");
  return { workspace: currentWorkspace, learner: currentLearner, sessionId };
}
