import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Learner, Workspace } from "@/types/api";
import { AppProvider, useAppStore } from "./AppContext";

const workspace: Workspace = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "零基础机器学习",
  slug: "machine-learning",
  default_language: "zh-CN",
  created_at: "2026-08-16T08:00:00Z",
};
const otherWorkspace: Workspace = {
  ...workspace,
  id: "22222222-2222-4222-8222-222222222222",
  name: "数据结构",
  slug: "data-structures",
};
const learner: Learner = {
  id: "33333333-3333-4333-8333-333333333333",
  workspace_id: workspace.id,
  display_name: "小林",
  language: "zh-CN",
  created_at: "2026-08-16T08:00:00Z",
};
const originalSessionId = "44444444-4444-4444-8444-444444444444";

function Harness() {
  const store = useAppStore();
  return (
    <div>
      <output aria-label="当前会话">{store.sessionId}</output>
      <output aria-label="当前档案">{store.currentLearner?.display_name ?? "无"}</output>
      <button type="button" onClick={() => store.setWorkspace(workspace)}>
        再选同一主题
      </button>
      <button type="button" onClick={() => store.setLearner(learner)}>
        再选同一档案
      </button>
      <button type="button" onClick={() => store.setWorkspace(otherWorkspace)}>
        切换主题
      </button>
    </div>
  );
}

describe("AppProvider learning context", () => {
  afterEach(cleanup);

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      "knowtier.app-state.v1",
      JSON.stringify({
        version: 1,
        currentWorkspace: workspace,
        currentLearner: learner,
        currentDocumentId: null,
        sessionId: originalSessionId,
        recentWorkspaces: [workspace],
        recentLearners: [learner],
        recentDocuments: [],
        preferences: { uiLocale: "zh-CN" },
      }),
    );
  });

  it("preserves conversation identity when the same topic and profile are selected", () => {
    render(
      <AppProvider>
        <Harness />
      </AppProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "再选同一主题" }));
    fireEvent.click(screen.getByRole("button", { name: "再选同一档案" }));

    expect(screen.getByLabelText("当前会话")).toHaveTextContent(
      originalSessionId,
    );
    expect(screen.getByLabelText("当前档案")).toHaveTextContent("小林");
  });

  it("starts a different conversation when the learning topic changes", () => {
    render(
      <AppProvider>
        <Harness />
      </AppProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "切换主题" }));

    expect(screen.getByLabelText("当前会话")).not.toHaveTextContent(
      originalSessionId,
    );
    expect(screen.getByLabelText("当前档案")).toHaveTextContent("无");
  });
});
