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

export function DomainVersionPage() {
  return <VersionHistoryPage kind="domain" />;
}
export function LearnerVersionPage() {
  return <VersionHistoryPage kind="learner" />;
}

function VersionHistoryPage({ kind }: { kind: "domain" | "learner" }) {
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
    return <EmptyState title="尚未选择上下文" />;
  const query = kind === "domain" ? domain : learner;
  if (query.isLoading) return <LoadingState label="正在加载版本记录" />;
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
        eyebrow="Version history"
        title={kind === "domain" ? "领域图谱版本" : "学生图谱版本"}
        description="版本记录只读展示，不提供后端不存在的回滚、删除或编辑操作。"
        actions={
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
            <Link
              to="/history/domain"
              className={`rounded px-2.5 py-1.5 text-xs ${kind === "domain" ? "bg-indigo-50 text-[#3157D5] dark:bg-indigo-950" : "text-slate-500"}`}
            >
              领域
            </Link>
            <Link
              to="/history/learner"
              className={`rounded px-2.5 py-1.5 text-xs ${kind === "learner" ? "bg-indigo-50 text-[#3157D5] dark:bg-indigo-950" : "text-slate-500"}`}
            >
              学生
            </Link>
          </div>
        }
      />
      {items.length === 0 ? (
        <EmptyState
          title="暂无版本"
          description="完成摄取或学习对话后，后端会创建版本记录。"
        />
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => setSelected(item)}
              className="flex w-full items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-indigo-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
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
                      ? (item as RevisionSummary).status
                      : `${(item as LearnerRevision).assertions_added} 条新增`}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDate(item.created_at, true)}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-300" />
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
      eyebrow={`${kind === "domain" ? "领域图谱" : "学生图谱"}版本`}
      title={<span className="font-mono">v{item.sequence_number}</span>}
      description={`版本 v${item.sequence_number} 详情`}
      width="lg"
    >
      {detail.isLoading ? (
        <LoadingState label="正在读取版本详情" />
      ) : detail.isError ? (
        <div className="mt-4">
          <ErrorState error={detail.error} />
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
