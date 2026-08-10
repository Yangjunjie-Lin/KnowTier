import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  GitCommitHorizontal,
  Layers3,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/services/api";
import { queryKeys } from "@/lib/queryKeys";
import { formatDate } from "@/lib/utils";
import { versionStatusLabel } from "@/lib/versionDetails";
import { useAppStore } from "@/stores/AppContext";
import type { LearnerRevision, RevisionSummary } from "@/types/api";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/States";
import { PageHeader } from "@/components/shared/PageHeader";
import { Sheet } from "@/components/shared/Sheet";
import {
  DomainVersionDetail,
  LearnerVersionDetail,
} from "@/components/history/VersionDetails";
import { useI18n } from "@/lib/i18n";

export function DomainVersionPage() {
  return <VersionHistoryPage kind="domain" />;
}
export function LearnerVersionPage() {
  return <VersionHistoryPage kind="learner" />;
}

function VersionHistoryPage({ kind }: { kind: "domain" | "learner" }) {
  const { locale, pick } = useI18n();
  const { currentWorkspace, currentLearner } = useAppStore();
  const [selected, setSelected] = useState<
    RevisionSummary | LearnerRevision | null
  >(null);
  const domain = useQuery({
    queryKey: queryKeys.domainRevisions(currentWorkspace?.id ?? ""),
    queryFn: ({ signal }) =>
      api.listDomainRevisions(currentWorkspace!.id, signal),
    enabled: kind === "domain" && Boolean(currentWorkspace),
  });
  const learner = useQuery({
    queryKey: queryKeys.learnerRevisions(currentLearner?.id ?? ""),
    queryFn: ({ signal }) =>
      api.listLearnerRevisions(currentLearner!.id, signal),
    enabled: kind === "learner" && Boolean(currentLearner),
  });
  if (
    (kind === "domain" && !currentWorkspace) ||
    (kind === "learner" && !currentLearner)
  )
    return (
      <EmptyState
        title={kind === "domain" ? pick("尚未选择学习空间", "No workspace selected") : pick("尚未选择学习者", "No learner selected")}
        description={
          kind === "domain"
            ? pick("选择学习空间后可查看领域图谱的历史版本。", "Select a workspace to view domain-map history.")
            : pick("选择学习者后可查看个人学习状态的历史版本。", "Select a learner to view their progress history.")
        }
        action={
          <Link to="/init" className="primary-button">
            {pick("前往选择", "Select now")}
          </Link>
        }
      />
    );
  const query = kind === "domain" ? domain : learner;
  if (query.isLoading) return <LoadingState label={pick("正在加载版本记录", "Loading version history")} />;
  if (query.isError)
    return (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    );
  const items = (query.data?.items ?? []) as Array<
    RevisionSummary | LearnerRevision
  >;
  return (
    <div>
      <PageHeader
        eyebrow={pick("变化记录", "Change history")}
        title={kind === "domain" ? pick("领域图谱版本", "Domain map versions") : pick("学生图谱版本", "Learner map versions")}
        description={
          kind === "domain"
            ? pick("追踪知识点、关系和来源如何随资料处理逐步变化。", "Track how knowledge points, relationships, and sources change as materials are processed.")
            : pick("追踪掌握度、误解、证据和推荐动作如何随学习更新。", "Track how mastery, misconceptions, evidence, and recommendations change with learning.")
        }
        actions={
          <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900" role="group" aria-label={pick("版本类型", "Version type")}>
            <Link
              to="/history/domain"
              aria-current={kind === "domain" ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${kind === "domain" ? "bg-indigo-50 text-[#3157D5] dark:bg-indigo-950" : "text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
            >
              {pick("领域图谱", "Domain map")}
            </Link>
            <Link
              to="/history/learner"
              aria-current={kind === "learner" ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${kind === "learner" ? "bg-indigo-50 text-[#3157D5] dark:bg-indigo-950" : "text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
            >
              {pick("学生图谱", "Learner map")}
            </Link>
          </div>
        }
      />
      {items.length === 0 ? (
        <EmptyState
          title={pick("暂无版本", "No versions yet")}
          description={
            kind === "domain"
              ? pick("处理第一份学习资料后，这里会出现领域图谱版本。", "Process your first learning material to create a domain-map version.")
              : pick("完成一次学习对话后，这里会出现个人学习版本。", "Complete a lesson to create a learner-progress version.")
          }
          action={
            <Link
              to={kind === "domain" ? "/materials" : "/learn"}
              className="primary-button"
            >
              {kind === "domain" ? pick("添加学习资料", "Add material") : pick("开始学习", "Start learning")}
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => setSelected(item)}
              aria-label={pick(`查看${kind === "domain" ? "领域" : "学生"}图谱版本 v${item.sequence_number}`, `View ${kind === "domain" ? "domain" : "learner"} map version v${item.sequence_number}`)}
              className="surface-card group flex w-full items-center gap-4 p-4 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#3157D5]/40"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-[#3157D5] dark:bg-indigo-950">
                {kind === "domain" ? (
                  <Layers3 className="h-4 w-4" />
                ) : (
                  <GitCommitHorizontal className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-medium">
                    v{item.sequence_number}
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">
                    {kind === "domain"
                      ? versionStatusLabel((item as RevisionSummary).status, locale)
                      : pick(`${(item as LearnerRevision).assertions_added} 条新增`, `${(item as LearnerRevision).assertions_added} additions`)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDate(item.created_at, true, locale)}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#3157D5]" />
            </button>
          ))}
        </div>
      )}
      {selected && (
        <RevisionDrawer
          kind={kind}
          item={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function RevisionDrawer({
  kind,
  item,
  onClose,
}: {
  kind: "domain" | "learner";
  item: RevisionSummary | LearnerRevision;
  onClose: () => void;
}) {
  const { pick } = useI18n();
  const { currentWorkspace, currentLearner } = useAppStore();
  const detail = useQuery<RevisionSummary | LearnerRevision>({
    queryKey: ["revision-detail", kind, item.id],
    queryFn: async ({ signal }) =>
      kind === "domain"
        ? await api.getDomainRevision(currentWorkspace!.id, item.id, signal)
        : await api.getLearnerRevision(currentLearner!.id, item.id, signal),
    enabled: Boolean(item),
  });
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      eyebrow={kind === "domain" ? pick("领域图谱版本", "Domain map version") : pick("学生图谱版本", "Learner map version")}
      title={<span className="font-mono">v{item.sequence_number}</span>}
      description={pick(`版本 v${item.sequence_number} 详情`, `Version v${item.sequence_number} details`)}
      width="lg"
    >
      {detail.isLoading ? (
        <LoadingState label={pick("正在读取版本详情", "Loading version details")} />
      ) : detail.isError ? (
        <div className="mt-4">
          <ErrorState
            error={detail.error}
            onRetry={() => void detail.refetch()}
          />
        </div>
      ) : (
        kind === "domain" ? (
          <DomainVersionDetail data={detail.data} />
        ) : (
          <LearnerVersionDetail data={detail.data} />
        )
      )}
    </Sheet>
  );
}
