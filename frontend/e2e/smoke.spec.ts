import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";

type ProviderKind = "mock" | "siliconflow" | "custom_openai_compatible";
type RoleModelsFixture = Record<
  "teacher" | "extractor" | "grader" | "graph" | "vision" | "embedding",
  string
>;
interface ModelProfileFixture {
  id: string;
  name: string;
  provider: ProviderKind;
  base_url: string | null;
  allow_local: boolean;
  credential_storage: "session" | "os_keyring";
  models: RoleModelsFixture;
  timeout_seconds: number;
  max_retries: number;
  temperature: number;
  max_tokens: number;
  active: boolean;
  connection_status: "untested" | "connected" | "error";
  last_tested_at: string | null;
  error_summary: string | null;
  updated_at: string;
  credential_present: boolean;
  credential_masked: string | null;
}
type ModelProfileInputFixture = Omit<
  ModelProfileFixture,
  | "id"
  | "active"
  | "connection_status"
  | "last_tested_at"
  | "error_summary"
  | "updated_at"
  | "credential_present"
  | "credential_masked"
> & { api_key?: string };

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
const modelProfileId = "12121212-1212-4121-8121-121212121212";
const visualStylePath = path.join(process.cwd(), "e2e", "visual-mask.css");

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

async function seedWorkspaceContext(page: Page) {
  await page.addInitScript(
    ({ seededWorkspace, seededLearner }) => {
      localStorage.setItem(
        "knowtier.app-state.v1",
        JSON.stringify({
          version: 1,
          currentWorkspace: seededWorkspace,
          currentLearner: seededLearner,
          currentDocumentId: null,
          sessionId: "88888888-8888-4888-8888-888888888888",
          recentWorkspaces: [seededWorkspace],
          recentLearners: [seededLearner],
          recentDocuments: [],
          preferences: {
            apiBaseUrl: "/api",
            theme: "light",
            reducedMotion: true,
            graphDensity: "comfortable",
            defaultTeachingMode: "learn",
            explanationDetail: "balanced",
            prioritizeExamples: true,
            hintStrength: "balanced",
            reviewFrequency: "twice-weekly",
            fontSize: "medium",
            graphLabelDensity: "balanced",
          },
        }),
      );
    },
    { seededWorkspace: workspace, seededLearner: learner },
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth - root.clientWidth;
      }),
    )
    .toBeLessThanOrEqual(1);
}

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === "critical" || violation.impact === "serious",
  );
  expect(
    blocking,
    blocking
      .map(
        (violation) =>
          `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`,
      )
      .join("\n"),
  ).toEqual([]);
}

async function expectVisualSnapshot(page: Page, name: string) {
  await page.addStyleTag({ path: visualStylePath });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page).toHaveScreenshot(name, {
    fullPage: false,
    animations: "disabled",
    caret: "hide",
  });
}

async function learningPanel(page: Page, name: string): Promise<Locator> {
  const trigger = page.getByRole("button", { name: "学习状态", exact: true });
  let dialog = page.getByRole("dialog");
  if (await dialog.isVisible()) {
    await dialog.getByRole("tab", { name, exact: true }).click();
    return dialog.getByRole("region", { name });
  }
  if (await trigger.isVisible()) {
    await trigger.click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("tab", { name, exact: true }).click();
    return dialog.getByRole("region", { name });
  }
  return page.getByRole("region", { name });
}

async function closeLearningStatus(page: Page) {
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible()) {
    await dialog.getByRole("button", { name: "关闭详情" }).click();
    await expect(dialog).toHaveCount(0);
  }
}

async function installApiContract(page: Page) {
  let ingested = false;
  let chatRound = 0;
  let evidenceFailure = false;
  const scopedRequests: string[] = [];
  let modelProfiles: ModelProfileFixture[] = [
    {
      id: modelProfileId,
      name: "Mock Provider",
      provider: "mock",
      base_url: null,
      allow_local: false,
      credential_storage: "session",
      models: {
        teacher: "mock/default",
        extractor: "mock/default",
        grader: "mock/default",
        graph: "mock/default",
        vision: "mock/default",
        embedding: "mock/default",
      },
      timeout_seconds: 30,
      max_retries: 0,
      temperature: 0,
      max_tokens: 2048,
      active: true,
      connection_status: "connected",
      last_tested_at: now,
      error_summary: null,
      updated_at: now,
      credential_present: true,
      credential_masked: null,
    },
  ];
  await page.route("**/api/health", (route) => json(route, { status: "ok" }));
  await page.route("**/api/ready", (route) =>
    json(route, { postgres: true, neo4j: true, ready: true }),
  );
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();
    if (method === "GET" && path === `/v1/workspaces/${workspaceId}`)
      return json(route, workspace);
    if (method === "GET" && path === "/v1/model-config/active") {
      const role = url.searchParams.get("role") ?? "teacher";
      const active = modelProfiles.find((profile) => profile.active) ?? modelProfiles[0];
      return json(route, {
        role,
        provider: active.provider,
        model: active.models[role as keyof typeof active.models],
        profile_id: active.id,
        profile_name: active.name,
      });
    }
    if (method === "GET" && path === "/v1/model-config") {
      return json(route, {
        profiles: modelProfiles,
        active_profile_id: modelProfiles.find((profile) => profile.active)?.id ?? null,
      });
    }
    if (method === "POST" && path === "/v1/model-config/profiles") {
      const input = request.postDataJSON() as ModelProfileInputFixture;
      const { api_key: suppliedKey, ...safeInput } = input;
      const created: ModelProfileFixture = {
        ...safeInput,
        id: "13131313-1313-4131-8131-131313131313",
        base_url: input.base_url ?? "https://api.siliconflow.cn/v1",
        active: false,
        connection_status: "untested",
        last_tested_at: null,
        error_summary: null,
        updated_at: now,
        credential_present: Boolean(suppliedKey),
        credential_masked: suppliedKey ? "••••••••" : null,
      };
      modelProfiles = [...modelProfiles, created];
      return json(route, created, 201);
    }
    if (method === "PUT" && path.startsWith("/v1/model-config/profiles/")) {
      const id = path.split("/").at(-1)!;
      const input = request.postDataJSON() as ModelProfileInputFixture;
      const { api_key: suppliedKey, ...safeInput } = input;
      const current = modelProfiles.find((profile) => profile.id === id)!;
      const updated: ModelProfileFixture = {
        ...current,
        ...safeInput,
        id,
        credential_present: current.credential_present || Boolean(suppliedKey),
        credential_masked:
          current.credential_present || suppliedKey ? "••••••••" : null,
        connection_status: "untested",
        error_summary: null,
        updated_at: now,
      };
      modelProfiles = modelProfiles.map((profile) =>
        profile.id === id ? updated : profile,
      );
      return json(route, updated);
    }
    if (
      method === "GET" &&
      path.startsWith("/v1/model-config/profiles/") &&
      path.endsWith("/models")
    ) {
      return json(route, {
        profile_id: path.split("/")[4],
        provider: "siliconflow",
        models: ["sf-chat", "sf-embedding"],
        tested_at: now,
      });
    }
    if (
      method === "POST" &&
      path.startsWith("/v1/model-config/profiles/") &&
      path.endsWith("/test")
    ) {
      const id = path.split("/")[4];
      modelProfiles = modelProfiles.map((profile) =>
        profile.id === id
          ? { ...profile, connection_status: "connected", last_tested_at: now }
          : profile,
      );
      return json(route, {
        profile_id: id,
        provider: "siliconflow",
        models: ["sf-chat", "sf-embedding"],
        tested_at: now,
      });
    }
    if (
      method === "POST" &&
      path.startsWith("/v1/model-config/profiles/") &&
      path.endsWith("/activate")
    ) {
      const id = path.split("/")[4];
      modelProfiles = modelProfiles.map((profile) => ({
        ...profile,
        active: profile.id === id,
      }));
      return json(route, modelProfiles.find((profile) => profile.id === id));
    }
    if (
      method === "DELETE" &&
      path.startsWith("/v1/model-config/profiles/") &&
      path.endsWith("/credential")
    ) {
      const id = path.split("/")[4];
      modelProfiles = modelProfiles.map((profile) =>
        profile.id === id
          ? {
              ...profile,
              active: false,
              credential_present: false,
              credential_masked: null,
            }
          : profile.provider === "mock"
            ? { ...profile, active: true }
            : profile,
      );
      return json(route, modelProfiles.find((profile) => profile.id === id));
    }
    if (method === "GET" && path === "/v1/search") {
      return json(route, {
        query: url.searchParams.get("q") ?? "",
        truncated: false,
        items: [
          {
            kind: "knowledge",
            id: knowledgePointId,
            title: "贝叶斯定理",
            description: "知识图谱 · 知识点",
            path: `/graph/domain?node=${knowledgePointId}`,
            score: 5,
            metadata: {},
          },
          {
            kind: "material",
            id: documentId,
            title: "smoke.txt",
            description: "资料 · 已摄取",
            path: `/materials/${documentId}`,
            score: 3,
            metadata: {},
          },
        ],
      });
    }
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
  const learningStatusTrigger = page.getByRole("button", {
    name: "学习状态",
    exact: true,
  });
  if (await learningStatusTrigger.isVisible()) {
    await learningStatusTrigger.click();
    await expect(page.getByRole("dialog")).toContainText("掌握与模型变化");
    await expect(page.getByRole("dialog")).toContainText("学生关系+1");
    await closeLearningStatus(page);
  } else {
    await expect(page.getByText(/版本 77777777/)).toBeVisible();
  }

  let prerequisitePanel = await learningPanel(page, "前置知识");
  await expect(prerequisitePanel).toContainText("联合分布基础");
  await expect(prerequisitePanel).toContainText("概率公理基础");
  let misconceptionPanel = await learningPanel(page, "误解");
  await expect(misconceptionPanel).toContainText("把后验概率当作先验概率");
  let evidencePanel = await learningPanel(page, "掌握证据");
  await expect(evidencePanel).toContainText("BAYES_EXPLANATION");
  await expect(evidencePanel).not.toContainText("OTHER_KP_EVIDENCE");
  await expect(evidencePanel).not.toContainText("UNASSOCIATED_EVIDENCE");
  await closeLearningStatus(page);

  await page
    .getByLabel("学习消息", { exact: true })
    .fill("请把服务器目标切换到梯度下降");
  await page.getByRole("button", { name: /发送/ }).click();
  await expect(
    page.getByText("本轮服务器已切换到梯度下降。", { exact: true }),
  ).toBeVisible();
  prerequisitePanel = await learningPanel(page, "前置知识");
  await expect(prerequisitePanel).toContainText("导数方向基础");
  misconceptionPanel = await learningPanel(page, "误解");
  await expect(misconceptionPanel).toContainText("把梯度方向弄反了");
  evidencePanel = await learningPanel(page, "掌握证据");
  await expect(evidencePanel).toContainText("GRADIENT_APPLICATION");
  prerequisitePanel = await learningPanel(page, "前置知识");
  await expect(prerequisitePanel).not.toContainText("联合分布基础");
  await expect(prerequisitePanel).not.toContainText("概率公理基础");
  misconceptionPanel = await learningPanel(page, "误解");
  await expect(misconceptionPanel).not.toContainText("把后验概率当作先验概率");
  evidencePanel = await learningPanel(page, "掌握证据");
  await expect(evidencePanel).not.toContainText("BAYES_EXPLANATION");
  await closeLearningStatus(page);

  setEvidenceFailure(true);
  await page
    .getByLabel("学习消息", { exact: true })
    .fill("在当前目标继续一轮并模拟证据读取失败");
  await page.getByRole("button", { name: /发送/ }).click();
  evidencePanel = await learningPanel(page, "掌握证据");
  await expect(evidencePanel).toContainText("部分数据不可用");
  prerequisitePanel = await learningPanel(page, "前置知识");
  await expect(prerequisitePanel).toContainText("导数方向基础");
  misconceptionPanel = await learningPanel(page, "误解");
  await expect(misconceptionPanel).toContainText("把梯度方向弄反了");
  setEvidenceFailure(false);
  evidencePanel = await learningPanel(page, "掌握证据");
  await evidencePanel.getByRole("button", { name: "重试" }).click();
  await expect(evidencePanel).toContainText("GRADIENT_APPLICATION");
  await expect(evidencePanel).not.toContainText("部分数据不可用");
  await closeLearningStatus(page);
  await expect(page.getByLabel("学习消息", { exact: true })).toBeEnabled();

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

  await page.goto("/overview");
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page);
  await expectVisualSnapshot(page, "overview-desktop.png");

  await page.goto("/materials");
  await expect(page.getByRole("heading", { name: /资料/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page);
  await expectVisualSnapshot(page, "materials-list.png");

  await page.goto("/learn");
  await expect(page.getByLabel("学习消息", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/Teacher 运行模型/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page);
  await expectVisualSnapshot(page, "learn-workbench.png");
});

test("offline recovery and HTTP fault surfaces remain actionable", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await seedWorkspaceContext(page);
  await installApiContract(page);

  await page.goto("/overview");
  await page.route("**/v1/learners/**/model**", async (route) => {
    await route.abort("failed");
  });
  await page.reload();
  await expect(
    page.getByText("部分数据暂不可用").or(page.getByText("个人模型读取失败")).first(),
  ).toBeVisible({ timeout: 15_000 });
  await page.unroute("**/v1/learners/**/model**");
  const retry = page.getByRole("button", { name: /重试/ }).first();
  if (await retry.isVisible()) {
    await retry.click();
  } else {
    await page.reload();
  }
  await expect(page.getByRole("heading", { name: /Smoke Learner/ })).toBeVisible({
    timeout: 15_000,
  });

  await page.goto("/model");
  await page.route("**/v1/learners/**/model**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "simulated server failure" }),
    });
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "重试" }).or(page.getByText("服务端发生错误，请稍后重试。")).first(),
  ).toBeVisible({ timeout: 15_000 });
  await page.unroute("**/v1/learners/**/model**");
  await page.reload();
  await expect(page.getByRole("heading", { name: "个人模型" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page);
});

test("SiliconFlow profile lifecycle is visible, dynamic and secret-safe", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await seedWorkspaceContext(page);
  await installApiContract(page);

  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "模型与供应商" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新建配置" }).click();

  await page
    .getByRole("combobox", { name: "供应商", exact: true })
    .selectOption("siliconflow");
  await page.getByLabel("配置名称").fill("SiliconFlow 验收");
  await expect(
    page.getByRole("textbox", { name: "Base URL", exact: true }),
  ).toHaveValue(
    "https://api.siliconflow.cn/v1",
  );
  await page.getByLabel("API Key").fill("e2e-secret-never-persist-me");

  await page.getByRole("button", { name: "刷新模型" }).click();
  await page.getByRole("button", { name: "统一模型" }).click();
  await expect(page.getByLabel("所有角色使用")).toBeEnabled();
  await page.getByLabel("所有角色使用").fill("sf-chat");
  await page.getByRole("button", { name: "启用配置" }).click();
  await expect(page.getByText("当前启用：SiliconFlow 验收")).toBeVisible();
  await expect(page.getByText(/Teacher · siliconflow \/ sf-chat/)).toBeVisible();
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(
    page.getByRole("button", { name: /SiliconFlow 验收 连接成功/ }),
  ).toBeVisible();
  await expect(page.getByText(/最近测试/)).toBeVisible();

  const persistedState = await page.evaluate(() =>
    localStorage.getItem("knowtier.app-state.v1"),
  );
  expect(persistedState).not.toContain("e2e-secret-never-persist-me");

  await page.getByRole("button", { name: "删除凭据" }).click();
  await expect(page.getByRole("button", { name: "删除凭据" })).toHaveCount(0);
  await expect(page.getByText("当前启用：Mock Provider")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page);
  await expectVisualSnapshot(page, "settings-model-providers.png");
});

test("global search shortcut, graph keyboard list and responsive visuals", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await seedWorkspaceContext(page);
  await installApiContract(page);

  await page.goto("/overview");
  await expect(page.getByRole("link", { name: "打开全局搜索" })).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page).toHaveURL(/\/search$/);
  const searchInput = page.getByLabel("搜索知识、资料或学习状态");
  await expect(searchInput).toBeFocused();
  await searchInput.fill("贝叶斯");
  await searchInput.press("Enter");
  const results = page.getByRole("region", { name: "全局搜索结果" });
  await expect(results).toContainText("找到 2 项");
  await expect(results.getByRole("link", { name: /贝叶斯定理/ })).toBeVisible();
  await expect(results.getByRole("link", { name: /smoke.txt/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page);
  await expectVisualSnapshot(page, "global-search-results.png");

  await page.goto("/graph/domain");
  await page.getByRole("button", { name: "切换到列表视图" }).click();
  const nodeOptions = page.getByRole("listbox", { name: "图谱节点" });
  const firstNode = nodeOptions.getByRole("option").first();
  const secondNode = nodeOptions.getByRole("option").nth(1);
  await firstNode.focus();
  await page.keyboard.press("ArrowDown");
  await expect(secondNode).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("节点详情");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page);
  await expectVisualSnapshot(page, "domain-graph-list.png");
});
