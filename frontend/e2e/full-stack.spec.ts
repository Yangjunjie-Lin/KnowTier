import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type APIRequestContext,
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
  const workspaceSlug = `full-stack-e2e-${suffix}`;
  const learnerName = `E2E Learner ${suffix}`;
  const filename = `bayes-${suffix}.txt`;

  await page.goto("/init");
  await page
    .getByPlaceholder("例如：机器学习基础")
    .fill(workspaceName);
  await page.getByPlaceholder("machine-learning").fill(workspaceSlug);
  const workspace = await captureJson<IdentifiedPayload>(
    page,
    "POST",
    "/v1/workspaces",
    () => page.getByRole("button", { name: /创建 Workspace/ }).click(),
  );
  expect(workspace.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

  await expect(page.getByRole("heading", { name: "学习者" })).toBeVisible();
  await page.getByPlaceholder("例如：林同学").fill(learnerName);
  const learner = await captureJson<IdentifiedPayload>(
    page,
    "POST",
    "/v1/learners",
    () => page.getByRole("button", { name: /创建并进入总览/ }).click(),
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
          "Bayes' theorem updates a prior belief with evidence. Conditional probability explains how the update is interpreted. A worked example compares prior and posterior belief.",
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
        .getByRole("button", { name: /开始摄取|重新摄取/ })
        .click(),
  );
  expect(ingestion.document_id).toBe(document.id);
  expect(ingestion.graph_revision_id).not.toBe("");
  expect(ingestion.knowledge_point_count).toBeGreaterThan(0);

  const extractedKnowledge = await captureJson<{ blueprint: unknown }>(
    page,
    "GET",
    `/v1/documents/${document.id}/extracted-knowledge`,
    () => page.getByRole("button", { name: "抽取知识" }).click(),
  );
  expect(JSON.stringify(extractedKnowledge.blueprint)).toContain(
    "source concept",
  );
  await expect(page.getByText("source concept", { exact: true }).first()).toBeVisible();

  await page.goto("/learn");
  await expect(
    page.getByRole("heading", { name: /学习空间|教学工作台/ }),
  ).toBeVisible();
  const attachmentButton = page.getByRole("button", {
    name: /附加资料|附件|选择已有资料/,
  });
  await attachmentButton.first().click();
  await page.getByRole("button", { name: new RegExp(filename) }).last().click();
  await page
    .getByLabel("学习消息", { exact: true })
    .fill("Explain the source concept and check whether I understand it.");
  const chat = await captureJson<ChatPayload>(
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
  expect(chat.response).not.toBe("");
  expect(chat.learner_update.mastery_score).toBeGreaterThanOrEqual(0);
  expect(chat.learner_update.mastery_score).toBeLessThanOrEqual(1);
  expect(chat.learner_update.confidence).toBeGreaterThanOrEqual(0);
  expect(chat.learner_update.confidence).toBeLessThanOrEqual(1);
  expect(chat.learner_graph_update?.revision_id).toBeTruthy();
  await expect(page.getByText(chat.response, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/掌握度/).first()).toBeVisible();

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
});
