import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Brain,
  CalendarClock,
  CheckCircle2,
  MessageCircle,
  Network,
  RefreshCw,
  Sparkles,
  TrendingUp,
  UploadCloud,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { queryKeys } from "@/lib/queryKeys";
import { formatDate, percent } from "@/lib/utils";
import { readableAction } from "@/lib/learningPath";
import { isApiError } from "@/lib/api/errors";
import { useAppStore } from "@/stores/AppContext";
import {
  CognitiveBadge,
  MasteryBar,
} from "@/components/shared/LearningVisuals";
import {
  EmptyState,
  ErrorState,
  PartialSuccess,
  Skeleton,
} from "@/components/shared/States";
import { PageHeader } from "@/components/shared/PageHeader";
import { useI18n } from "@/lib/i18n";

export function OverviewPage() {
  const { locale, pick, t } = useI18n();
  const {
    currentWorkspace,
    currentLearner,
    recentDocuments,
    clearLocalHistory,
  } = useAppStore();
  const workspaceId = currentWorkspace?.id;
  const learnerId = currentLearner?.id;
  const manifest = useQuery({
    queryKey: queryKeys.manifest(workspaceId ?? ""),
    queryFn: ({ signal }) => api.getManifest(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
  });
  const model = useQuery({
    queryKey: queryKeys.model(learnerId ?? ""),
    queryFn: ({ signal }) => api.getLearnerModel(learnerId as string, signal),
    enabled: Boolean(learnerId),
  });
  const evidence = useQuery({
    queryKey: queryKeys.evidence(learnerId ?? ""),
    queryFn: ({ signal }) =>
      api.getLearnerEvidence(learnerId as string, signal),
    enabled: Boolean(learnerId),
  });
  const revisions = useQuery({
    queryKey: queryKeys.learnerRevisions(learnerId ?? ""),
    queryFn: ({ signal }) =>
      api.listLearnerRevisions(learnerId as string, signal),
    enabled: Boolean(learnerId),
  });
  const domainRevisions = useQuery({
    queryKey: queryKeys.domainRevisions(workspaceId ?? ""),
    queryFn: ({ signal }) =>
      api.listDomainRevisions(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
  });
  if (!workspaceId || !learnerId)
    return (
      <EmptyState
        title={pick("尚未完成初始化", "Setup is not complete")}
        description={pick("先连接学习空间和学习者，才能加载学习状态。", "Connect a workspace and learner to view learning progress.")}
        action={
          <Link to="/init" className="primary-button">
            {pick("开始初始化", "Start setup")}
          </Link>
        }
      />
    );
  if (manifest.isError && model.isError)
    return (
      <ErrorState
        error={manifest.error ?? model.error}
        onRetry={() => {
          void manifest.refetch();
          void model.refetch();
        }}
        action={
          [manifest.error, model.error].some(
            (error) => isApiError(error) && error.status === 404,
          ) ? (
            <button
              type="button"
              className="inline-flex min-h-9 items-center rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-400"
              onClick={clearLocalHistory}
            >
              {pick("重新初始化", "Run setup again")}
            </button>
          ) : undefined
        }
      />
    );
  const manifestData = manifest.data?.data;
  const items = model.data?.items ?? [];
  const dueItems = items.filter(
    (item) =>
      item.next_review_at &&
      new Date(item.next_review_at).getTime() <= Date.now(),
  );
  const misconceptionCount = items.reduce(
    (sum, item) => sum + item.critical_misconceptions.length,
    0,
  );
  const avgMastery = items.length
    ? items.reduce((sum, item) => sum + percent(item.mastery_score), 0) /
      items.length
    : 0;
  const latestLearnerRevision = revisions.data?.items?.[0];
  const latestDomainRevision = domainRevisions.data?.items?.[0];
  const hasRecentMaterial = recentDocuments.some(
    (document) => document.workspaceId === workspaceId,
  );
  // Domain knowledge belongs to the shared learning topic, not to this
  // learner. A new profile should still receive first-lesson guidance when
  // materials or another profile have already populated the topic graph.
  const hasStartedLearning =
    items.length > 0 || (evidence.data?.items.length ?? 0) > 0;
  const isNewLearner =
    !model.isLoading &&
    !evidence.isLoading &&
    !model.isError &&
    !evidence.isError &&
    !hasStartedLearning;
  const refreshing = [
    manifest,
    model,
    evidence,
    revisions,
    domainRevisions,
  ].some((query) => query.isFetching);
  return (
    <div>
      <PageHeader
        eyebrow={pick("学习总览", "Learning overview")}
        title={pick(`欢迎回来，${currentLearner?.display_name}`, `Welcome back, ${currentLearner?.display_name}`)}
        description={
          isNewLearner
            ? pick(
                "你的学习档案已经准备好。选择一种方式，开始第一次学习。",
                "Your learning profile is ready. Choose a path for your first lesson.",
              )
            : pick(
                "从今天的掌握概况开始，或直接继续上次的学习。",
                "Review today's progress or continue your latest lesson.",
              )
        }
        actions={
          !isNewLearner ? (
            <Link to="/learn" className="primary-button">
              <BookOpen className="h-4 w-4" />
              {pick("继续学习", "Continue learning")}
            </Link>
          ) : undefined
        }
      />
      {(manifest.isError ||
        model.isError ||
        evidence.isError ||
        revisions.isError ||
        domainRevisions.isError) && (
        <PartialSuccess title={pick("部分数据暂不可用", "Some data is temporarily unavailable")}>
          {pick("可用模块仍显示真实数据；对应区块可以单独重试。", "Available sections still show real data. Retry unavailable sections independently.")}
        </PartialSuccess>
      )}
      {isNewLearner ? (
        <GettingStartedPanel hasRecentMaterial={hasRecentMaterial} />
      ) : (
        <>
      <section className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label={pick("学习概览指标", "Learning overview metrics")}>
        <MetricCard
          href="/graph/domain"
          icon={<Network className="h-4 w-4" />}
          label={pick("学习主题", "Learning topics")}
          value={
            manifest.isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : manifest.isError ? (
              <span className="text-sm text-amber-700">{pick("不可用", "Unavailable")}</span>
            ) : (
              String(manifestData?.knowledge_point_count ?? 0)
            )
          }
          caption={
            manifest.isError
              ? pick("知识内容读取失败", "Learning content unavailable")
              : pick(`已整理 ${manifestData?.assertion_count ?? 0} 条知识关联`, `${manifestData?.assertion_count ?? 0} learning connections organized`)
          }
        />
        <MetricCard
          href="/model"
          icon={<Brain className="h-4 w-4" />}
          label={pick("已学习主题", "Topics started")}
          value={
            model.isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : model.isError ? (
              <span className="text-sm text-amber-700">{pick("不可用", "Unavailable")}</span>
            ) : (
              String(items.length)
            )
          }
          caption={model.isError ? pick("学习进度读取失败", "Learning progress unavailable") : pick(`平均掌握度 ${Math.round(avgMastery)}%`, `Average mastery ${Math.round(avgMastery)}%`)}
        />
        <MetricCard
          href="/learning-path"
          icon={<CalendarClock className="h-4 w-4" />}
          label={pick("待复习", "Due for review")}
          value={
            model.isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : model.isError ? (
              <span className="text-sm text-amber-700">{pick("不可用", "Unavailable")}</span>
            ) : (
              String(dueItems.length)
            )
          }
          caption={model.isError ? pick("学习进度读取失败", "Learning progress unavailable") : pick("按复习计划确定", "Based on your review schedule")}
          tone={dueItems.length > 0 ? "amber" : "default"}
        />
        <MetricCard
          href="/model"
          icon={<AlertTriangle className="h-4 w-4" />}
          label={pick("需要纠正", "Needs correction")}
          value={
            model.isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : model.isError ? (
              <span className="text-sm text-amber-700">{pick("不可用", "Unavailable")}</span>
            ) : (
              String(misconceptionCount)
            )
          }
          caption={
            evidence.isLoading
              ? pick("正在读取证据", "Loading evidence")
              : evidence.isError
              ? pick("证据读取失败", "Evidence unavailable")
              : pick(`证据 ${evidence.data?.items.length ?? 0} 条`, `${evidence.data?.items.length ?? 0} evidence records`)
          }
          tone={misconceptionCount > 0 ? "red" : "default"}
        />
      </section>
      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[1.35fr_1fr]">
        <section className="surface-card p-4 sm:p-5">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">{pick("当前掌握概况", "Current mastery")}</h2>
              <p className="mt-1 text-xs text-slate-500">
                {pick("根据你的回答和掌握检测自动更新", "Updated from your answers and mastery checks")}
              </p>
            </div>
            <Link
              to="/model"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#3157D5]"
            >
              {pick("查看全部进度", "View all progress")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {model.isLoading ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : model.isError ? (
            <ErrorState error={model.error} onRetry={() => void model.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              title={pick("还没有掌握度数据", "No mastery data yet")}
              description={pick("完成一次学习对话后，个人模型会出现真实知识点状态。", "Complete a learning turn to create real knowledge-point progress.")}
              action={
                <Link to="/learn" className="secondary-button">
                  {pick("进入学习空间", "Open learning")}
                </Link>
              }
            />
          ) : (
            <div className="space-y-4">
              {items.slice(0, 5).map((item) => (
                <div
                  key={item.knowledge_point_id}
                  className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {item.knowledge_point}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <CognitiveBadge level={item.current_level} size="xs" />
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">
                        {pick(`证据 ${item.evidence_count}`, `${item.evidence_count} evidence records`)}
                      </span>
                    </div>
                  </div>
                  <MasteryBar
                    value={item.mastery_score}
                    confidence={item.confidence}
                  />
                  <span className="text-right font-mono text-xs text-slate-500">
                    {readableAction(item.recommended_action, locale)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="space-y-5">
          <div className="surface-card p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#3157D5]" />
            <h2 className="text-base font-semibold">{pick("最近学习记录变化", "Recent learning record changes")}</h2>
            </div>
            <RevisionLine
              label={pick("知识内容", "Learning content")}
              revision={latestDomainRevision?.sequence_number}
              date={latestDomainRevision?.created_at}
              href="/history/domain"
              loading={domainRevisions.isLoading}
              unavailable={domainRevisions.isError}
            />
            <RevisionLine
              label={pick("我的进度", "My progress")}
              revision={latestLearnerRevision?.sequence_number}
              date={latestLearnerRevision?.created_at}
              href="/history/learner"
              loading={revisions.isLoading}
              unavailable={revisions.isError}
            />
          </div>
          <div className="surface-card p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">{pick("学习提醒", "Learning reminders")}</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {pick("根据你的学习记录自动整理", "Organized from your learning records")}
                </p>
              </div>
              {model.isLoading ? (
                <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
              ) : dueItems.length > 0 || misconceptionCount > 0 ? (
                <AlertTriangle
                  className={`h-5 w-5 ${misconceptionCount > 0 ? "text-red-500" : "text-amber-500"}`}
                />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              )}
            </div>
            {model.isLoading ? (
              <p className="text-sm text-slate-500" role="status">
                {pick("正在读取学习提醒…", "Loading learning reminders…")}
              </p>
            ) : model.isError ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-800 dark:text-amber-300">
                <span>{pick("学习提醒暂不可用。", "Learning reminders are temporarily unavailable.")}</span>
                <button
                  type="button"
                  className="quiet-button min-h-8 px-2 text-xs"
                  onClick={() => void model.refetch()}
                >
                  {t("common.retry")}
                </button>
              </div>
            ) : dueItems.length === 0 && misconceptionCount === 0 ? (
              <p className="text-sm text-slate-500">
                {pick("当前没有需要特别关注的项目。", "Nothing needs special attention right now.")}
              </p>
            ) : (
              <div className="space-y-2 text-sm">
                {dueItems.slice(0, 3).map((item) => (
                  <Link
                    key={item.knowledge_point_id}
                    to="/learn"
                    state={{
                      learningTarget: {
                        id: item.knowledge_point_id,
                        name: item.knowledge_point,
                        source: "overview",
                      },
                    }}
                    className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-200"
                  >
                    <span>{pick(`复习：${item.knowledge_point}`, `Review: ${item.knowledge_point}`)}</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ))}
                {misconceptionCount > 0 && (
                  <Link
                    to="/model"
                    className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-red-900 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-200"
                  >
                    <span>{pick(`${misconceptionCount} 条误解需要复核`, `${misconceptionCount} misconceptions to review`)}</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
      <div className="surface-card mt-5 px-4 py-3.5 text-xs leading-5 text-slate-500 sm:px-5">
        <span className="font-medium text-slate-700 dark:text-slate-200">
          {pick("实时数据：", "Live data: ")}
        </span>
        {pick("掌握度、练习证据与内容变化均来自当前学习记录。", "Mastery, practice evidence, and content changes come from current learning records.")}
        <button
          type="button"
          className="ml-2 inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-[#3157D5] hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-[#3157D5]/40 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-indigo-950/40"
          disabled={refreshing}
          aria-live="polite"
          onClick={() => {
            void manifest.refetch();
            void model.refetch();
            void evidence.refetch();
            void revisions.refetch();
            void domainRevisions.refetch();
          }}
        >
          <RefreshCw
            className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
          />
          {refreshing ? pick("正在刷新", "Refreshing") : t("common.refresh")}
        </button>
      </div>
        </>
      )}
    </div>
  );
}

function GettingStartedPanel({
  hasRecentMaterial,
}: {
  hasRecentMaterial: boolean;
}) {
  const { pick } = useI18n();
  return (
    <section
      className="relative mt-5 overflow-hidden rounded-3xl border border-indigo-200 bg-gradient-to-br from-white via-indigo-50/70 to-sky-50 p-5 shadow-[0_18px_55px_rgba(49,87,213,0.10)] sm:p-7 dark:border-indigo-900 dark:from-slate-900 dark:via-indigo-950/35 dark:to-slate-900"
      aria-labelledby="getting-started-title"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-indigo-300/20 blur-3xl dark:bg-indigo-600/15"
      />
      <div className="relative">
        <div className="inline-flex items-center gap-2 rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          {pick("第一次使用", "First time here")}
        </div>
        <h2
          id="getting-started-title"
          className="mt-4 text-xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-2xl"
        >
          {hasRecentMaterial
            ? pick("你的资料已经就绪，现在开始第一次学习", "Your material is ready. Start your first lesson")
            : pick("选择最适合你的开始方式", "Choose the best way to begin")}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          {pick(
            "不需要先理解知识图谱或学习模型。你只管提问，系统会在每次讲解后用一个小问题确认理解，并自动记录进度。",
            "You do not need to understand knowledge maps or learning models. Ask a question, answer one short check after each explanation, and your progress is saved automatically.",
          )}
        </p>
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <Link
            to="/learn"
            className="group rounded-2xl border border-[#3157D5] bg-[#3157D5] p-4 text-white shadow-[0_8px_24px_rgba(49,87,213,0.22)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(49,87,213,0.28)] focus:outline-none focus:ring-2 focus:ring-[#3157D5]/45 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
          >
            <span className="flex items-center justify-between gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
                <MessageCircle className="h-5 w-5" aria-hidden="true" />
              </span>
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </span>
            <span className="mt-4 block text-base font-semibold">
              {hasRecentMaterial
                ? pick("用已有资料开始学习", "Learn from my material")
                : pick("直接问第一个问题", "Ask my first question")}
            </span>
            <span className="mt-1 block text-xs leading-5 text-indigo-100">
              {pick("适合已经有明确问题，或想先从零了解一个主题。", "Best when you have a question or want to learn a topic from scratch.")}
            </span>
          </Link>
          <Link
            to="/materials"
            className="group rounded-2xl border border-slate-200 bg-white/85 p-4 shadow-sm transition-[transform,border-color,box-shadow] hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#3157D5]/40 dark:border-slate-700 dark:bg-slate-900/80 dark:hover:border-indigo-700"
          >
            <span className="flex items-center justify-between gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-[#3157D5] dark:bg-indigo-950 dark:text-indigo-300">
                <UploadCloud className="h-5 w-5" aria-hidden="true" />
              </span>
              <ArrowRight className="h-5 w-5 text-slate-400 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </span>
            <span className="mt-4 block text-base font-semibold text-slate-900 dark:text-white">
              {pick("先添加一份学习资料", "Add a learning material first")}
            </span>
            <span className="mt-1 block text-xs leading-5 text-slate-500">
              {pick("适合课件、讲义、笔记或照片，回答会附带可查看的来源。", "Best for slides, notes, documents, or photos. Answers include traceable sources.")}
            </span>
          </Link>
        </div>
        <ol className="mt-6 grid gap-3 border-t border-indigo-100 pt-5 text-xs text-slate-600 sm:grid-cols-3 dark:border-indigo-900/60 dark:text-slate-300" aria-label={pick("第一次学习的三个步骤", "Three steps for your first lesson")}>
          {[
            pick("选择资料或直接提问", "Add material or ask"),
            pick("阅读讲解并回答小问题", "Read and answer one check"),
            pick("在“我的进度”查看变化", "See changes in My progress"),
          ].map((step, index) => (
            <li key={step} className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white font-mono text-[10px] font-bold text-[#3157D5] shadow-sm dark:bg-slate-800 dark:text-indigo-300">
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function MetricCard({
  href,
  icon,
  label,
  value,
  caption,
  tone = "default",
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  caption: string;
  tone?: "default" | "amber" | "red";
}) {
  const { pick } = useI18n();
  return (
    <Link
      to={href}
      className="surface-card group min-w-0 p-3.5 transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-[0_10px_28px_rgba(15,23,42,0.07)] focus:outline-none focus:ring-2 focus:ring-[#3157D5]/40 sm:p-4 dark:hover:border-indigo-800"
    >
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{label}</span>
        <span
          className={
            tone === "red"
              ? "text-red-500"
              : tone === "amber"
                ? "text-amber-500"
                : "text-[#3157D5]"
          }
        >
          {icon}
        </span>
      </div>
      <div className="mt-2 min-h-8 text-2xl font-bold tracking-tight">
        {value}
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-600 dark:text-slate-400">{caption}</p>
      <span className="sr-only">{pick("打开详情", "Open details")}</span>
    </Link>
  );
}

function RevisionLine({
  label,
  revision,
  date,
  href,
  loading = false,
  unavailable = false,
}: {
  label: string;
  revision?: number;
  date?: string;
  href: string;
  loading?: boolean;
  unavailable?: boolean;
}) {
  const { locale, pick } = useI18n();
  return (
    <Link
      to={href}
      className="group flex items-center justify-between rounded-lg border-t border-slate-100 px-2 py-3 transition-colors first:border-t-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
    >
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
          {loading
            ? pick("正在读取版本", "Loading version")
            : unavailable
              ? pick("版本读取失败", "Version unavailable")
              : date
                ? formatDate(date, true, locale)
                : pick("暂无版本", "No version yet")}
        </p>
      </div>
      <span className="font-mono text-xs text-[#3157D5]">
        {loading
          ? "…"
          : unavailable
            ? pick("不可用", "Unavailable")
            : revision !== undefined
              ? `v${revision}`
              : "—"}
      </span>
    </Link>
  );
}
