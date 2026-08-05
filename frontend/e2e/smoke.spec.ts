import { expect, test, type Page, type Route } from "@playwright/test";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const learnerId = "22222222-2222-4222-8222-222222222222";
const documentId = "33333333-3333-4333-8333-333333333333";
const knowledgePointId = "44444444-4444-4444-8444-444444444444";
const secondKnowledgePointId = "44444444-4444-4444-8444-444444444445";
const assertionId = "55555555-5555-4555-8555-555555555555";
const domainRevisionId = "66666666-6666-4666-8666-666666666666";
const learnerRevisionId = "77777777-7777-4777-8777-777777777777";
const now = "2026-08-05T08:00:00Z";

const workspace = {
  id: workspaceId,
  name: "Smoke Workspace",
  slug: "smoke-workspace",
  default_language: "zh-CN",
  created_at: now,
};
const learner = {
  id: learnerId,
  workspace_id: workspaceId,
  display_name: "Smoke Learner",
  language: "zh-CN",
  created_at: now,
};
const modelItem = {
  knowledge_point_id: knowledgePointId,
  knowledge_point: "贝叶斯定理",
  current_level: 2,
  mastery_score: 0.72,
  confidence: 0.88,
  evidence_count: 2,
  critical_misconceptions: [],
  prerequisites: [
    {
      knowledge_point_id: secondKnowledgePointId,
      knowledge_point: "条件概率",
      mastery_score: 0.8,
      current_level: 2,
      status: "mastered",
    },
  ],
  all_prerequisites_mastered: true,
  prerequisite_status: "mastered",
  last_interaction_at: now,
  next_review_at: "2026-08-06T08:00:00Z",
  recommended_action: "进行迁移练习",
};
const graph = {
  elements: {
    nodes: [
      {
        data: {
          id: knowledgePointId,
          type: "KnowledgePoint",
          label: "贝叶斯定理",
        },
      },
      {
        data: {
          id: secondKnowledgePointId,
          type: "KnowledgePoint",
          label: "条件概率",
        },
      },
    ],
    edges: [
      {
        data: {
          id: assertionId,
          assertion_id: assertionId,
          source: secondKnowledgePointId,
          target: knowledgePointId,
          relation_type: "PREREQUISITE_OF",
          confidence: 0.94,
        },
      },
    ],
  },
  meta: { revision_id: domainRevisionId },
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installApiContract(page: Page) {
  let ingested = false;
  const scopedRequests: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();
    if (path !== "/v1/workspaces" && path !== "/health" && path !== "/ready") {
      if (request.headers()["x-workspace-id"] === workspaceId)
        scopedRequests.push(`${method} ${path}`);
    }

    if (method === "POST" && path === "/v1/workspaces")
      return json(route, workspace, 201);
    if (method === "POST" && path === "/v1/learners")
      return json(route, learner, 201);
    if (method === "GET" && path === `/v1/learners/${learnerId}`)
      return json(route, learner);
    if (
      method === "POST" &&
      path === `/v1/workspaces/${workspaceId}/documents`
    ) {
      return json(
        route,
        {
          id: documentId,
          workspace_id: workspaceId,
          filename: "smoke.txt",
          mime_type: "text/plain",
          byte_size: 25,
          sha256: "a".repeat(64),
          status: "UPLOADED",
          page_count: null,
          warnings: [],
          created_at: now,
        },
        201,
      );
    }
    if (method === "GET" && path === `/v1/documents/${documentId}`) {
      return json(route, {
        id: documentId,
        workspace_id: workspaceId,
        filename: "smoke.txt",
        mime_type: "text/plain",
        byte_size: 25,
        sha256: "a".repeat(64),
        status: ingested ? "INGESTED" : "UPLOADED",
        page_count: ingested ? 1 : null,
        warnings: [],
        created_at: now,
      });
    }
    if (method === "POST" && path === `/v1/documents/${documentId}/ingest`) {
      ingested = true;
      return json(route, {
        document_id: documentId,
        parser: "plain-text",
        page_count: 1,
        chunk_count: 1,
        knowledge_point_count: 2,
        assertion_count: 1,
        warning_count: 0,
        graph_revision_id: domainRevisionId,
        parser_chain: ["plain-text"],
        ocr_used: false,
        vision_used: false,
        detected_language: "zh-CN",
        low_confidence_blocks: 0,
      });
    }
    if (method === "GET" && path === "/v1/graph/manifest") {
      return json(route, {
        workspace_id: workspaceId,
        graph_revision_id: domainRevisionId,
        data: {
          workspace_id: workspaceId,
          revision_id: domainRevisionId,
          ontology: {
            entity_types: ["KnowledgePoint"],
            relation_types: ["PREREQUISITE_OF"],
          },
          top_level_domains: ["概率论"],
          theories: ["Bayes"],
          knowledge_point_count: 2,
          assertion_count: 1,
          source_count: 1,
          major_clusters: [{ name: "概率论", node_count: 2 }],
        },
      });
    }
    if (method === "GET" && path === "/v1/graph/export")
      return json(route, graph);
    if (method === "GET" && path === "/v1/graph/revisions") {
      return json(route, {
        workspace_id: workspaceId,
        items: [
          {
            id: domainRevisionId,
            workspace_id: workspaceId,
            sequence_number: 1,
            parent_revision_id: null,
            status: "ACTIVE",
            projection_status: "PROJECTED",
            manifest: null,
            summary: { source: "smoke" },
            created_by: "ingestion",
            model_run_id: null,
            created_at: now,
            projected_at: now,
          },
        ],
      });
    }
    if (method === "GET" && path === `/v1/learners/${learnerId}/model`) {
      return json(route, {
        learner_id: learnerId,
        workspace_id: workspaceId,
        items: [modelItem],
      });
    }
    if (method === "GET" && path === `/v1/learners/${learnerId}/evidence`) {
      return json(route, { learner_id: learnerId, items: [] });
    }
    if (
      method === "GET" &&
      path === `/v1/learners/${learnerId}/knowledge-graph`
    )
      return json(route, graph);
    if (
      method === "GET" &&
      path === `/v1/learners/${learnerId}/graph/revisions`
    ) {
      return json(route, {
        learner_id: learnerId,
        items: [
          {
            id: learnerRevisionId,
            workspace_id: workspaceId,
            learner_id: learnerId,
            session_id: "88888888-8888-4888-8888-888888888888",
            turn_id: "99999999-9999-4999-8999-999999999999",
            sequence_number: 1,
            parent_revision_id: null,
            change_summary: { decision: "PROMOTE" },
            assertions_added: 1,
            assertions_superseded: 0,
            created_at: now,
          },
        ],
      });
    }
    if (method === "POST" && path === "/v1/chat") {
      return json(route, {
        turn_id: "99999999-9999-4999-8999-999999999999",
        response: "条件概率是理解贝叶斯定理的关键。",
        target_knowledge_point: { id: knowledgePointId, name: "贝叶斯定理" },
        cognitive_level: 2,
        teaching_action: "GUIDED_EXPLANATION",
        assessment: {
          type: "short_answer",
          question: "请解释先验概率与后验概率。",
        },
        learner_update: {
          decision: "PROMOTE",
          reason: "证据充分",
          current_level: 2,
          mastery_score: 0.72,
          confidence: 0.88,
        },
        graph_update: {
          revision_id: domainRevisionId,
          nodes_added: 0,
          assertions_added: 0,
          assertions_superseded: 0,
        },
        learner_graph_update: {
          revision_id: learnerRevisionId,
          assertions_added: 1,
          assertions_superseded: 0,
        },
        tool_usage: {
          enabled: true,
          steps: 1,
          tools: ["graph_context"],
          fallback: false,
        },
        sources: [{ document_id: documentId, excerpt: "贝叶斯定理" }],
      });
    }
    return json(route, { detail: `Unmocked ${method} ${path}` }, 500);
  });
  return scopedRequests;
}

test("initialization, ingestion, tutoring, model and both graph views", async ({
  page,
}) => {
  const scopedRequests = await installApiContract(page);
  await page.goto("/init");
  await page.getByPlaceholder("例如：机器学习基础").fill("Smoke Workspace");
  await page.getByPlaceholder("machine-learning").fill("smoke-workspace");
  await page.getByRole("button", { name: /创建 Workspace/ }).click();
  await expect(page.getByRole("heading", { name: "学习者" })).toBeVisible();
  await page.getByPlaceholder("例如：林同学").fill("Smoke Learner");
  await page.getByRole("button", { name: /创建并进入总览/ }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(
    page.getByRole("heading", { name: /Smoke Learner/ }),
  ).toBeVisible();

  await page.goto("/materials");
  await page.locator('input[type="file"]').setInputFiles({
    name: "smoke.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("贝叶斯定理需要条件概率。", "utf8"),
  });
  await expect(page).toHaveURL(new RegExp(`/materials/${documentId}$`));
  await page.getByRole("button", { name: "开始摄取" }).click();
  await expect(
    page.getByRole("region", { name: "本次摄取报告" }),
  ).toContainText("plain-text");
  await expect(
    page.getByRole("region", { name: "本次摄取报告" }),
  ).toContainText("知识点");

  await page.goto("/learn");
  await page.getByLabel("学习消息").fill("请解释贝叶斯定理");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(
    page.getByText("条件概率是理解贝叶斯定理的关键。"),
  ).toBeVisible();
  await expect(page.getByText(/学生版本：77777777/)).toBeVisible();

  await page.goto("/model");
  await expect(page.getByRole("heading", { name: "个人模型" })).toBeVisible();
  await expect(page.getByText("贝叶斯定理", { exact: true })).toBeVisible();

  await page.goto("/graph/domain");
  await expect(
    page.getByRole("heading", { name: "领域知识图谱" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("application", { name: /知识图谱/ })
      .locator("canvas")
      .first(),
  ).toBeVisible();

  await page.goto("/graph/student");
  await expect(
    page.getByRole("heading", { name: "学生知识图谱" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("application", { name: /知识图谱/ })
      .locator("canvas")
      .first(),
  ).toBeVisible();
  expect(scopedRequests).toContain(`POST /v1/learners`);
  expect(scopedRequests).toContain(`POST /v1/documents/${documentId}/ingest`);
  expect(scopedRequests).toContain("POST /v1/chat");
});
