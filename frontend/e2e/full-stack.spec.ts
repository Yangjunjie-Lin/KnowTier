import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";

interface IdentifiedPayload {
  id: string;
}

interface IngestionPayload {
  document_id: string;
  graph_revision_id: string;
  knowledge_point_count: number;
}

interface ChatPayload {
  response: string;
  target_knowledge_point: {
    id: string;
    name: string;
  };
  learner_update: {
    mastery_score: number;
    confidence: number;
  };
  learner_graph_update: {
    revision_id: string;
  } | null;
}

interface GraphPayload {
  elements: {
    nodes: Array<{ data: { id: string } }>;
    edges: Array<{ data: { id: string; assertion_id?: string } }>;
  };
}

interface LearnerModelPayload {
  learner_id: string;
  items: Array<{
    knowledge_point_id: string;
    mastery_score: number;
  }>;
}

interface RevisionPayload {
  items: Array<{
    id: string;
    sequence_number: number;
  }>;
}

async function captureJson<T>(
  page: Page,
  method: string,
  pathSuffix: string,
  action: () => Promise<unknown>,
  inspect?: (response: Response) => void | Promise<void>,
): Promise<T> {
  const responsePromise = page.waitForResponse(
    (response) => {
      const pathname = new URL(response.url()).pathname;
      return (
        response.request().method() === method && pathname.endsWith(pathSuffix)
      );
    },
    { timeout: 10 * 60_000 },
  );
  await action();
  const response = await responsePromise;
  expect(
    response.ok(),
    `${method} ${pathSuffix} returned HTTP ${response.status()}`,
  ).toBe(true);
  await inspect?.(response);
  return (await response.json()) as T;
}

async function waitUntilReady(request: APIRequestContext): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const response = await request.get("/api/ready", { timeout: 5_000 });
          return response.status();
        } catch {
          return 0;
        }
      },
      {
        message: "FastAPI did not become ready again after restart",
        timeout: 3 * 60_000,
        intervals: [1_000, 2_000, 3_000, 5_000],
      },
    )
    .toBe(200);
}

async function learningPanel(page: Page, name: string): Promise<Locator> {
  const directPanel = page.getByRole("region", { name, exact: true });
  if (await directPanel.isVisible()) return directPanel;

  let dialog = page.getByRole("dialog");
  if (!(await dialog.isVisible())) {
    const detailsButton = page.getByRole("button", {
      name: "查看详情",
      exact: true,
    });
    const statusButton = page.getByRole("button", {
      name: "学习状态",
      exact: true,
    });
    if (await detailsButton.isVisible()) await detailsButton.click();
    else await statusButton.click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
  }
  await dialog.getByRole("tab", { name, exact: true }).click();
  return dialog.getByRole("region", { name, exact: true });
}

async function closeLearningDetails(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog");
  if (!(await dialog.isVisible())) return;
  await dialog
    .getByRole("button", { name: /关闭详情|Close details/, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

function restartApi(): void {
  const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
  const composeFile =
    process.env.COGNIGRAPH_E2E_COMPOSE_FILE ??
    path.join(repositoryRoot, "docker-compose.e2e.yml");
  execFileSync(
    "docker",
    ["compose", "-f", composeFile, "restart", "api"],
    {
      cwd: repositoryRoot,
      stdio: "inherit",
      timeout: 3 * 60_000,
    },
  );
}

test("real stack persists ingestion, tutoring, graphs, and versions across an API restart", async ({
  page,
  request,
}, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.retry}`;
  const workspaceName = `Full-stack E2E ${suffix}`;
  const learnerName = `E2E Learner ${suffix}`;
  const filename = `bayes-${suffix}.txt`;

  await page.goto("/init");
  await page
    .getByLabel("学习主题")
    .fill(workspaceName);
  const workspace = await captureJson<IdentifiedPayload>(
    page,
    "POST",
    "/v1/workspaces",
    () => page.getByRole("button", { name: "保存主题，下一步" }).click(),
  );
  expect(workspace.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

  await expect(page.getByRole("heading", { name: "我们怎么称呼你？" })).toBeVisible();
  await page.getByLabel("希望怎样称呼你").fill(learnerName);
  const learner = await captureJson<IdentifiedPayload>(
    page,
    "POST",
    "/v1/learners",
    () => page.getByRole("button", { name: "完成设置，开始使用" }).click(),
  );
  await expect(page).toHaveURL(/\/overview$/);

  await page.goto("/materials");
  const document = await captureJson<IdentifiedPayload>(
    page,
    "POST",
    `/v1/workspaces/${workspace.id}/documents`,
    () =>
      page.locator('input[type="file"]').setInputFiles({
        name: filename,
        mimeType: "text/plain",
        buffer: Buffer.from(
          "Conditional probability foundation supports the Bayesian updating target. Bayesian updating combines a prior belief with likelihood evidence to obtain a posterior belief.",
          "utf8",
        ),
      }),
  );
  await expect(page).toHaveURL(
    new RegExp(`/materials/${document.id}$`),
  );
  await expect(page.getByRole("heading", { name: filename })).toBeVisible();

  const ingestion = await captureJson<IngestionPayload>(
    page,
    "POST",
    `/v1/documents/${document.id}/ingest`,
    () =>
      page
        .getByRole("button", { name: /分析资料并整理知识|重新分析资料/ })
        .click(),
  );
  expect(ingestion.document_id).toBe(document.id);
  expect(ingestion.graph_revision_id).not.toBe("");
  expect(ingestion.knowledge_point_count).toBeGreaterThanOrEqual(2);

  const extractedKnowledge = await captureJson<{ blueprint: unknown }>(
    page,
    "GET",
    `/v1/documents/${document.id}/extracted-knowledge`,
    () => page.getByRole("tab", { name: "整理出的知识" }).click(),
  );
  expect(JSON.stringify(extractedKnowledge.blueprint)).toContain(
    "bayesian updating target",
  );
  await expect(
    page.getByText("bayesian updating target", { exact: true }).first(),
  ).toBeVisible();

  await page.goto("/learn");
  await expect(
    page.getByRole("heading", { name: /开始学习|教学工作台/ }),
  ).toBeVisible();
  const attachmentButton = page.getByRole("button", {
    name: /附加资料|附件|选择已有资料/,
  });
  await attachmentButton.first().click();
  await page
    .getByRole("menuitemcheckbox", { name: new RegExp(filename) })
    .click();
  const learningInput = page.getByLabel("学习消息", { exact: true });
  await learningInput.fill("Teach me conditional probability foundation.");
  const prerequisiteChat = await captureJson<ChatPayload>(
    page,
    "POST",
    "/v1/chat",
    () => page.getByRole("button", { name: /发送/ }).click(),
    (response) => {
      const requestPayload = response.request().postDataJSON() as {
        attachment_ids?: unknown;
      };
      expect(requestPayload.attachment_ids).toContain(document.id);
    },
  );
  expect(prerequisiteChat.target_knowledge_point.name).toBe(
    "conditional probability foundation",
  );
  expect(prerequisiteChat.learner_graph_update?.revision_id).toBeTruthy();
  await expect(learningInput).toBeEnabled();

  await learningInput.fill(
    "A condition restricts the sample space and uses the joint event.",
  );
  await captureJson<ChatPayload>(
    page,
    "POST",
    "/v1/chat",
    () => page.getByRole("button", { name: /发送/ }).click(),
  );
  await expect(learningInput).toBeEnabled();
  await learningInput.fill(
    "We divide the joint probability by the probability of the condition.",
  );
  const promotedPrerequisite = await captureJson<ChatPayload>(
    page,
    "POST",
    "/v1/chat",
    () => page.getByRole("button", { name: /发送/ }).click(),
  );
  expect(promotedPrerequisite.learner_update.mastery_score).toBeGreaterThanOrEqual(0.75);
  await expect(learningInput).toBeEnabled();

  await learningInput.fill("Teach me bayesian updating target.");
  const targetChat = await captureJson<ChatPayload>(
    page,
    "POST",
    "/v1/chat",
    () => page.getByRole("button", { name: /发送/ }).click(),
  );
  expect(targetChat.target_knowledge_point.name).toBe("bayesian updating target");
  expect(targetChat.learner_update.mastery_score).toBeGreaterThanOrEqual(0);
  expect(targetChat.learner_update.mastery_score).toBeLessThanOrEqual(1);
  expect(targetChat.learner_update.confidence).toBeGreaterThanOrEqual(0);
  expect(targetChat.learner_update.confidence).toBeLessThanOrEqual(1);
  await expect(page.getByText(targetChat.response, { exact: false }).last()).toBeVisible();
  await expect(page.getByText(/掌握度/).first()).toBeVisible();

  const prerequisitePanel = page.getByRole("region", {
    name: "前置知识",
    exact: true,
  });
  await expect(prerequisitePanel).toBeVisible();
  await expect(prerequisitePanel).toContainText("conditional probability foundation");
  await expect(prerequisitePanel).toContainText("已掌握");

  await learningInput.fill(
    "E2E_WRONG_BAYES_ANSWER I ignore likelihood evidence.",
  );
  const wrongAnswer = await captureJson<ChatPayload>(
    page,
    "POST",
    "/v1/chat",
    () => page.getByRole("button", { name: /发送/ }).click(),
  );
  expect(wrongAnswer.target_knowledge_point.id).toBe(
    targetChat.target_knowledge_point.id,
  );
  const misconceptionPanel = await learningPanel(page, "误解");
  await expect(misconceptionPanel).toContainText(
    "Bayesian updating ignores the likelihood evidence.",
  );
  await expect(misconceptionPanel).toContainText("仍然有效");
  const evidencePanel = await learningPanel(page, "掌握证据");
  await expect(evidencePanel).toContainText("正确性");
  await closeLearningDetails(page);

  await learningInput.fill(
    "E2E_CORRECT_BAYES_ANSWER The posterior combines the prior and likelihood evidence.",
  );
  await captureJson<ChatPayload>(
    page,
    "POST",
    "/v1/chat",
    () => page.getByRole("button", { name: /发送/ }).click(),
  );
  const resolvedMisconceptionPanel = await learningPanel(page, "误解");
  await expect(resolvedMisconceptionPanel).toContainText(
    "当前没有记录到仍然有效的误解。",
  );
  const historyToggle = resolvedMisconceptionPanel.getByRole("button", {
    name: /历史误解（1）/,
  });
  await historyToggle.click();
  await expect(resolvedMisconceptionPanel).toContainText("已解决");
  await expect(resolvedMisconceptionPanel).toContainText(
    "Bayesian updating ignores the likelihood evidence.",
  );
  await closeLearningDetails(page);

  const learnerModel = await captureJson<LearnerModelPayload>(
    page,
    "GET",
    `/v1/learners/${learner.id}/model`,
    () => page.goto("/model"),
  );
  expect(learnerModel.learner_id).toBe(learner.id);
  expect(learnerModel.items.length).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "个人模型" })).toBeVisible();

  const domainGraph = await captureJson<GraphPayload>(
    page,
    "GET",
    "/v1/graph/export",
    () => page.goto("/graph/domain"),
  );
  expect(domainGraph.elements.nodes.length).toBeGreaterThan(0);
  await expect(
    page.getByRole("heading", { name: "领域知识图谱" }),
  ).toBeVisible();

  const learnerGraph = await captureJson<GraphPayload>(
    page,
    "GET",
    `/v1/learners/${learner.id}/knowledge-graph`,
    () => page.goto("/graph/student"),
  );
  expect(learnerGraph.elements.nodes.length).toBeGreaterThan(1);
  expect(learnerGraph.elements.edges.length).toBeGreaterThan(0);
  await expect(
    page.getByRole("heading", { name: "学生知识图谱" }),
  ).toBeVisible();

  const domainRevisions = await captureJson<RevisionPayload>(
    page,
    "GET",
    "/v1/graph/revisions",
    () => page.goto("/history/domain"),
  );
  expect(domainRevisions.items.length).toBeGreaterThan(0);
  expect(domainRevisions.items.map((item) => item.id)).toContain(
    ingestion.graph_revision_id,
  );
  await expect(
    page.getByRole("heading", { name: "领域图谱版本" }),
  ).toBeVisible();

  const learnerRevisions = await captureJson<RevisionPayload>(
    page,
    "GET",
    `/v1/learners/${learner.id}/graph/revisions`,
    () => page.goto("/history/learner"),
  );
  expect(learnerRevisions.items.length).toBeGreaterThan(0);
  await expect(
    page.getByRole("heading", { name: "学生图谱版本" }),
  ).toBeVisible();

  restartApi();
  await waitUntilReady(request);

  const recoveredModel = await captureJson<LearnerModelPayload>(
    page,
    "GET",
    `/v1/learners/${learner.id}/model`,
    () => page.goto("/model"),
  );
  expect(recoveredModel.items.map((item) => item.knowledge_point_id)).toEqual(
    expect.arrayContaining(
      learnerModel.items.map((item) => item.knowledge_point_id),
    ),
  );

  const recoveredDomainGraph = await captureJson<GraphPayload>(
    page,
    "GET",
    "/v1/graph/export",
    () => page.goto("/graph/domain"),
  );
  expect(recoveredDomainGraph.elements.nodes.map((node) => node.data.id)).toEqual(
    expect.arrayContaining(
      domainGraph.elements.nodes.map((node) => node.data.id),
    ),
  );

  const recoveredLearnerGraph = await captureJson<GraphPayload>(
    page,
    "GET",
    `/v1/learners/${learner.id}/knowledge-graph`,
    () => page.goto("/graph/student"),
  );
  expect(recoveredLearnerGraph.elements.edges.map((edge) => edge.data.id)).toEqual(
    expect.arrayContaining(
      learnerGraph.elements.edges.map((edge) => edge.data.id),
    ),
  );

  const recoveredDomainRevisions = await captureJson<RevisionPayload>(
    page,
    "GET",
    "/v1/graph/revisions",
    () => page.goto("/history/domain"),
  );
  expect(recoveredDomainRevisions.items.map((item) => item.id)).toContain(
    ingestion.graph_revision_id,
  );

  const recoveredLearnerRevisions = await captureJson<RevisionPayload>(
    page,
    "GET",
    `/v1/learners/${learner.id}/graph/revisions`,
    () => page.goto("/history/learner"),
  );
  expect(recoveredLearnerRevisions.items.map((item) => item.id)).toEqual(
    expect.arrayContaining(learnerRevisions.items.map((item) => item.id)),
  );

  await page.goto("/learn");
  await expect(
    page.getByText(targetChat.response, { exact: true }).last(),
  ).toBeVisible();
  const recoveredLearningInput = page.getByLabel("学习消息", { exact: true });
  await recoveredLearningInput.fill(
    "Teach me bayesian updating target after the API restart.",
  );
  const recoveredTargetChat = await captureJson<ChatPayload>(
    page,
    "POST",
    "/v1/chat",
    () => page.getByRole("button", { name: /发送/ }).click(),
  );
  expect(recoveredTargetChat.target_knowledge_point.id).toBe(
    targetChat.target_knowledge_point.id,
  );

  const recoveredPrerequisitePanel = page.getByRole("region", {
    name: "前置知识",
    exact: true,
  });
  await expect(recoveredPrerequisitePanel).toBeVisible();
  await expect(recoveredPrerequisitePanel).toContainText(
    "conditional probability foundation",
  );
  await expect(recoveredPrerequisitePanel).toContainText("已掌握");
  const recoveredEvidencePanel = await learningPanel(page, "掌握证据");
  await expect(recoveredEvidencePanel).toContainText("正确性");
  const recoveredMisconceptionPanel = await learningPanel(page, "误解");
  await expect(recoveredMisconceptionPanel).toContainText(
    "当前没有记录到仍然有效的误解。",
  );
  await recoveredMisconceptionPanel
    .getByRole("button", { name: /历史误解（1）/ })
    .click();
  await expect(recoveredMisconceptionPanel).toContainText("已解决");
  await expect(recoveredMisconceptionPanel).toContainText(
    "Bayesian updating ignores the likelihood evidence.",
  );
  await closeLearningDetails(page);
});
