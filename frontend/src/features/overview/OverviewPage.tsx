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

export function OverviewPage() {
  const { currentWorkspace, currentLearner } = useAppStore();
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
        title="尚未完成初始化"
        description="先连接 Workspace 和学习者，才能加载学习状态。"
        action={
          <Link to="/init" className="primary-button">
            开始初始化
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
  return (
    <div>
      <PageHeader
        eyebrow="Workspace overview"
        title={`早上好，${currentLearner?.display_name}`}
        description="这里汇总当前学习状态、证据和两个图谱的最新版本。"
        actions={
          <Link to="/learn" className="primary-button">
            <BookOpen className="h-4 w-4" />
            继续学习
          </Link>
        }
      />
      {(manifest.isError ||
        model.isError ||
        evidence.isError ||
        revisions.isError) && (
        <PartialSuccess title="部分数据暂不可用">
          可用模块仍显示真实数据；对应区块可以单独重试。
        </PartialSuccess>
      )}
      <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Network className="h-4 w-4" />}
          label="领域知识点"
          value={
            manifest.isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              String(manifestData?.knowledge_point_count ?? 0)
            )
          }
          caption={`关系 ${manifestData?.assertion_count ?? 0} 条`}
        />
        <MetricCard
          icon={<Brain className="h-4 w-4" />}
          label="个人模型"
          value={
            model.isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              String(items.length)
            )
          }
          caption={`平均掌握度 ${Math.round(avgMastery)}%`}
        />
        <MetricCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="待复习"
          value={
            model.isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              String(dueItems.length)
            )
          }
          caption="按 next_review_at 确定"
          tone={dueItems.length > 0 ? "amber" : "default"}
        />
        <MetricCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="误解记录"
          value={
            model.isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              String(misconceptionCount)
            )
          }
          caption={`证据 ${evidence.data?.items.length ?? 0} 条`}
          tone={misconceptionCount > 0 ? "red" : "default"}
        />
      </section>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">当前掌握概况</h2>
              <p className="mt-1 text-xs text-slate-500">
                来自个人模型的确定性汇总
              </p>
            </div>
            <Link
              to="/model"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#3157D5]"
            >
              查看模型
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {model.isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              title="还没有掌握度数据"
              description="完成一次学习对话后，个人模型会出现真实知识点状态。"
              action={
                <Link to="/learn" className="secondary-button">
                  进入学习空间
                </Link>
              }
            />
          ) : (
            <div className="space-y-4">
              {items.slice(0, 5).map((item) => (
                <div
                  key={item.knowledge_point_id}
                  className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {item.knowledge_point}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <CognitiveBadge level={item.current_level} size="xs" />
                      <span className="text-[11px] text-slate-400">
                        证据 {item.evidence_count}
                      </span>
                    </div>
                  </div>
                  <MasteryBar
                    value={item.mastery_score}
                    confidence={item.confidence}
                  />
                  <span className="text-right font-mono text-xs text-slate-500">
                    {item.recommended_action}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#3157D5]" />
              <h2 className="text-base font-semibold">最近图谱版本</h2>
            </div>
            <RevisionLine
              label="领域图谱"
              revision={latestDomainRevision?.sequence_number}
              date={latestDomainRevision?.created_at}
              href="/history/domain"
            />
            <RevisionLine
              label="学生图谱"
              revision={latestLearnerRevision?.sequence_number}
              date={latestLearnerRevision?.created_at}
              href="/history/learner"
            />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">学习提醒</h2>
                <p className="mt-1 text-xs text-slate-500">
                  根据实时个人模型计算
                </p>
              </div>
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            </div>
            {dueItems.length === 0 && misconceptionCount === 0 ? (
              <p className="text-sm text-slate-500">
                当前没有需要特别关注的项目。
              </p>
            ) : (
              <div className="space-y-2 text-sm">
                {dueItems.slice(0, 3).map((item) => (
                  <Link
                    key={item.knowledge_point_id}
                    to="/learn"
                    className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-200"
                  >
                    <span>复习：{item.knowledge_point}</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ))}
                {misconceptionCount > 0 && (
                  <Link
                    to="/model"
                    className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-red-900 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-200"
                  >
                    <span>{misconceptionCount} 条误解需要复核</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
      <div className="mt-5 rounded-xl border border-slate-200 bg-white px-5 py-4 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        <span className="font-medium text-slate-700 dark:text-slate-200">
          数据边界：
        </span>
        总览没有固定指标；以上数值由 Manifest、Model、Evidence
        和版本接口实时组合。
        <button
          type="button"
          className="ml-2 inline-flex items-center gap-1 text-[#3157D5]"
          onClick={() => {
            void manifest.refetch();
            void model.refetch();
            void evidence.refetch();
            void revisions.refetch();
            void domainRevisions.refetch();
          }}
        >
          <RefreshCw className="h-3 w-3" />
          刷新
        </button>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  caption,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  caption: string;
  tone?: "default" | "amber" | "red";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
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
      <div className="mt-2 min-h-8 text-2xl font-semibold tracking-tight">
        {value}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{caption}</p>
    </div>
  );
}

function RevisionLine({
  label,
  revision,
  date,
  href,
}: {
  label: string;
  revision?: number;
  date?: string;
  href: string;
}) {
  return (
    <Link
      to={href}
      className="flex items-center justify-between border-t border-slate-100 py-3 first:border-t-0 dark:border-slate-800"
    >
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          {date ? formatDate(date, true) : "暂无版本"}
        </p>
      </div>
      <span className="font-mono text-xs text-[#3157D5]">
        {revision !== undefined ? `v${revision}` : "—"}
      </span>
    </Link>
  );
}
