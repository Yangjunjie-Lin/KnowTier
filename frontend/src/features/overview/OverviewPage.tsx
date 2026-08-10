import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Brain,
  CalendarClock,
  CheckCircle2,
  Network,
  RefreshCw,
  TrendingUp,
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
  const { currentWorkspace, currentLearner, clearLocalHistory } = useAppStore();
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
        description={pick("从今天的掌握概况开始，或直接继续上次的学习。", "Review today's progress or continue your latest lesson.")}
        actions={
          <Link to="/learn" className="primary-button">
            <BookOpen className="h-4 w-4" />
            {pick("继续学习", "Continue learning")}
          </Link>
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
      <section className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label={pick("学习概览指标", "Learning overview metrics")}>
        <MetricCard
          href="/graph/domain"
          icon={<Network className="h-4 w-4" />}
          label={pick("领域知识点", "Knowledge points")}
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
              ? pick("领域图谱读取失败", "Domain map unavailable")
              : pick(`关系 ${manifestData?.assertion_count ?? 0} 条`, `${manifestData?.assertion_count ?? 0} relationships`)
          }
        />
        <MetricCard
          href="/model"
          icon={<Brain className="h-4 w-4" />}
          label={pick("个人模型", "Progress model")}
          value={
            model.isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : model.isError ? (
              <span className="text-sm text-amber-700">{pick("不可用", "Unavailable")}</span>
            ) : (
              String(items.length)
            )
          }
          caption={model.isError ? pick("个人模型读取失败", "Progress model unavailable") : pick(`平均掌握度 ${Math.round(avgMastery)}%`, `Average mastery ${Math.round(avgMastery)}%`)}
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
          caption={model.isError ? pick("个人模型读取失败", "Progress model unavailable") : pick("按复习计划确定", "Based on your review schedule")}
          tone={dueItems.length > 0 ? "amber" : "default"}
        />
        <MetricCard
          href="/model"
          icon={<AlertTriangle className="h-4 w-4" />}
          label={pick("误解记录", "Misconceptions")}
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
                {pick("来自个人模型的确定性汇总", "A deterministic summary of your learning progress")}
              </p>
            </div>
            <Link
              to="/model"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#3157D5]"
            >
              {pick("查看模型", "View progress")}
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
              <h2 className="text-base font-semibold">{pick("最近图谱版本", "Recent graph versions")}</h2>
            </div>
            <RevisionLine
              label={pick("领域图谱", "Domain map")}
              revision={latestDomainRevision?.sequence_number}
              date={latestDomainRevision?.created_at}
              href="/history/domain"
              loading={domainRevisions.isLoading}
              unavailable={domainRevisions.isError}
            />
            <RevisionLine
              label={pick("学生图谱", "Learner map")}
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
                  {pick("根据实时个人模型计算", "Calculated from current progress")}
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
        {pick("掌握度、证据与图谱版本均来自当前学习记录。", "Mastery, evidence, and graph versions come from current learning records.")}
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
    </div>
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
