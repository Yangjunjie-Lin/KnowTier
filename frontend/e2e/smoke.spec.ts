import { expect, test, type Page, type Route } from "@playwright/test";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const learnerId = "22222222-2222-4222-8222-222222222222";
const documentId = "33333333-3333-4333-8333-333333333333";
const knowledgePointId = "44444444-4444-4444-8444-444444444444";
const secondKnowledgePointId = "44444444-4444-4444-8444-444444444445";
const thirdKnowledgePointId = "44444444-4444-4444-8444-444444444446";
const switchedKnowledgePointId = "44444444-4444-4444-8444-444444444447";
const switchedPrerequisiteId = "44444444-4444-4444-8444-444444444448";
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
const bayesModelItem = {
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
      knowledge_point: "联合分布基础",
      mastery_score: 0.8,
      current_level: 2,
      status: "mastered",
    },
    {
      knowledge_point_id: thirdKnowledgePointId,
      knowledge_point: "概率公理基础",
      mastery_score: 0,
      current_level: 1,
      status: "not_mastered",
    },
  ],
  all_prerequisites_mastered: false,
  prerequisite_status: "not_mastered",
  last_interaction_at: now,
  next_review_at: "2026-08-06T08:00:00Z",
  recommended_action: "进行迁移练习",
};
const switchedModelItem = {
  ...bayesModelItem,
  knowledge_point_id: switchedKnowledgePointId,
  knowledge_point: "梯度下降",
  mastery_score: 0.51,
  evidence_count: 1,
  critical_misconceptions: ["把梯度方向弄反了"],
  prerequisites: [
    {
      knowledge_point_id: switchedPrerequisiteId,
      knowledge_point: "导数方向基础",
      mastery_score: 0.62,
      current_level: 2,
      status: "not_mastered",
    },
  ],
  all_prerequisites_mastered: false,
  prerequisite_status: "not_mastered",
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
          label: "联合分布基础",
        },
      },
      {
        data: {
          id: thirdKnowledgePointId,
          type: "KnowledgePoint",
          label: "概率公理基础",
        },
      },
      {
        data: {
          id: switchedKnowledgePointId,
          type: "KnowledgePoint",
          label: "梯度下降",
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

function evidenceItem(
  id: string,
  targetId: string | undefined,
  evidenceType: string,
  misconception: string | null = null,
) {
  return {
    id,
    ...(targetId ? { knowledge_point_id: targetId } : {}),
    session_id: "88888888-8888-4888-8888-888888888888",
    turn_id: `99999999-9999-4999-8999-${id.slice(-12)}`,
    evidence_type: evidenceType,
    cognitive_level: 2,
    correctness_score: 0.72,
    reasoning_score: 0.68,
    independence_score: 0.74,
    transfer_score: 0.41,
    grader_confidence: 0.86,
    observed_misconceptions: misconception ? [misconception] : [],
    grader_explanation: `${evidenceType} 的真实评分说明`,
    created_at: now,
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installApiContract(page: Page) {
  let ingested = false;
  let chatRound = 0;
  let evidenceFailure = false;
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
    if (method === "GET" && path.startsWith("/v1/graph/nodes/")) {
      const nodeId = path.split("/").at(-1);
      const prerequisites =
        nodeId === knowledgePointId
          ? [
              { id: secondKnowledgePointId, display_name: "联合分布基础" },
              { id: thirdKnowledgePointId, display_name: "概率公理基础" },
            ]
          : nodeId === switchedKnowledgePointId
            ? [{ id: switchedPrerequisiteId, display_name: "导数方向基础" }]
            : [];
      return json(route, {
        workspace_id: workspaceId,
        graph_revision_id: domainRevisionId,
        data: {
          node: { id: nodeId, entity_type: "KnowledgePoint" },
          prerequisites,
        },
      });
    }
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
      const switched = chatRound >= 2;
      const activeItem = switched ? switchedModelItem : bayesModelItem;
      const prerequisiteState = {
        ...activeItem,
        knowledge_point_id: switched
          ? switchedPrerequisiteId
          : secondKnowledgePointId,
        knowledge_point: switched ? "导数方向基础" : "联合分布基础",
        mastery_score: switched ? 0.62 : 0.82,
        current_level: 2,
        evidence_count: 1,
        critical_misconceptions: [],
        prerequisites: [],
        all_prerequisites_mastered: true,
        prerequisite_status: "none",
      };
      return json(route, {
        learner_id: learnerId,
        workspace_id: workspaceId,
        items: [activeItem, prerequisiteState],
      });
    }
    if (method === "GET" && path === `/v1/learners/${learnerId}/evidence`) {
      if (evidenceFailure) {
        return json(route, { detail: "deterministic evidence outage" }, 503);
      }
      const switched = chatRound >= 2;
      return json(route, {
        learner_id: learnerId,
        items: [
          evidenceItem(
            switched
              ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
              : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
            switched ? switchedKnowledgePointId : knowledgePointId,
            switched ? "GRADIENT_APPLICATION" : "BAYES_EXPLANATION",
            switched ? "把梯度方向弄反了" : "把后验概率当作先验概率",
          ),
          evidenceItem(
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            "OTHER_KP_EVIDENCE",
          ),
          evidenceItem(
            "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            undefined,
            "UNASSOCIATED_EVIDENCE",
          ),
        ],
      });
    }
    if (
      method === "GET" &&
      path === `/v1/learners/${learnerId}/knowledge-graph`
    ) {
      const switched = chatRound >= 2;
      const activeTarget = switched ? switchedKnowledgePointId : knowledgePointId;
      const activeEvidence = switched
        ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
        : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
      const misconceptionText = switched
        ? "把梯度方向弄反了"
        : "把后验概率当作先验概率";
      return json(route, {
        elements: {
          nodes: [
            { data: { id: learnerId, type: "Learner", label: "Smoke Learner" } },
            { data: { id: activeTarget, type: "LearnerKnowledgeState" } },
            { data: { id: activeEvidence, type: "LearnerGraphResource" } },
          ],
          edges: [
            {
              data: {
                id: switched ? "misconception-2" : "misconception-1",
                assertion_id: switched ? "misconception-2" : "misconception-1",
                source: learnerId,
                target: activeTarget,
                predicate: "HAS_MISCONCEPTION",
                relation_type: "HAS_MISCONCEPTION",
                natural_language_description: misconceptionText,
                confidence: 0.82,
                valid_from: now,
                valid_to: null,
                source_turn_id: "99999999-9999-4999-8999-999999999999",
                evidence_id: activeEvidence,
              },
            },
            {
              data: {
                id: switched ? "mastery-evidence-2" : "mastery-evidence-1",
                assertion_id: switched ? "mastery-evidence-2" : "mastery-evidence-1",
                source: learnerId,
                target: activeEvidence,
                predicate: "HAS_MASTERY_EVIDENCE",
                relation_type: "HAS_MASTERY_EVIDENCE",
                confidence: 0.86,
                valid_from: now,
                valid_to: null,
                evidence_id: activeEvidence,
              },
            },
          ],
        },
        meta: { learner_graph_revision_id: learnerRevisionId },
      });
    }
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
      chatRound += 1;
      const switched = chatRound >= 2;
      return json(route, {
        turn_id: `99999999-9999-4999-8999-99999999999${Math.min(chatRound, 9)}`,
        response: switched
          ? "本轮服务器已切换到梯度下降。"
          : "本轮服务器已确认贝叶斯定理。",
        target_knowledge_point: switched
          ? { id: switchedKnowledgePointId, name: "梯度下降" }
          : { id: knowledgePointId, name: "贝叶斯定理" },
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
  return {
    scopedRequests,
    setEvidenceFailure: (value: boolean) => {
      evidenceFailure = value;
    },
  };
}

test("initialization, ingestion, tutoring, model and both graph views", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { scopedRequests, setEvidenceFailure } = await installApiContract(page);
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
  await page
    .getByLabel("学习消息", { exact: true })
    .fill("请解释贝叶斯定理");
  await page.getByRole("button", { name: /发送/ }).click();
  await expect(
    page.getByText("本轮服务器已确认贝叶斯定理。"),
  ).toBeVisible();
  await expect(page.getByText(/版本 77777777/)).toBeVisible();

  const prerequisitePanel = page.getByRole("region", { name: "前置知识" });
  const misconceptionPanel = page.getByRole("region", { name: "误解" });
  const evidencePanel = page.getByRole("region", { name: "掌握证据" });
  await expect(prerequisitePanel).toContainText("联合分布基础");
  await expect(prerequisitePanel).toContainText("概率公理基础");
  await expect(misconceptionPanel).toContainText("把后验概率当作先验概率");
  await expect(evidencePanel).toContainText("BAYES_EXPLANATION");
  await expect(evidencePanel).not.toContainText("OTHER_KP_EVIDENCE");
  await expect(evidencePanel).not.toContainText("UNASSOCIATED_EVIDENCE");

  await page
    .getByLabel("学习消息", { exact: true })
    .fill("请把服务器目标切换到梯度下降");
  await page.getByRole("button", { name: /发送/ }).click();
  await expect(
    page.getByText("本轮服务器已切换到梯度下降。", { exact: true }),
  ).toBeVisible();
  await expect(prerequisitePanel).toContainText("导数方向基础");
  await expect(misconceptionPanel).toContainText("把梯度方向弄反了");
  await expect(evidencePanel).toContainText("GRADIENT_APPLICATION");
  await expect(prerequisitePanel).not.toContainText("联合分布基础");
  await expect(prerequisitePanel).not.toContainText("概率公理基础");
  await expect(misconceptionPanel).not.toContainText("把后验概率当作先验概率");
  await expect(evidencePanel).not.toContainText("BAYES_EXPLANATION");

  setEvidenceFailure(true);
  await page
    .getByLabel("学习消息", { exact: true })
    .fill("在当前目标继续一轮并模拟证据读取失败");
  await page.getByRole("button", { name: /发送/ }).click();
  await expect(evidencePanel).toContainText("部分数据不可用");
  await expect(page.getByLabel("学习消息", { exact: true })).toBeEnabled();
  await expect(prerequisitePanel).toContainText("导数方向基础");
  await expect(misconceptionPanel).toContainText("把梯度方向弄反了");
  setEvidenceFailure(false);
  await evidencePanel.getByRole("button", { name: "重试" }).click();
  await expect(evidencePanel).toContainText("GRADIENT_APPLICATION");
  await expect(evidencePanel).not.toContainText("部分数据不可用");

  await page.goto("/model");
  await expect(page.getByRole("heading", { name: "个人模型" })).toBeVisible();
  await expect(page.getByText("梯度下降", { exact: true })).toBeVisible();

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
