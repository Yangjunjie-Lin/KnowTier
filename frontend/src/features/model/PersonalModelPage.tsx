import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Download,
  Filter,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/services/api";
import { queryKeys } from "@/lib/queryKeys";
import {
  displayPercent,
  formatDate,
  triggerResponseDownload,
} from "@/lib/utils";
import { useAppStore } from "@/stores/AppContext";
import type { LearnerModelItem } from "@/types/api";
import {
  CognitiveBadge,
  MasteryBar,
} from "@/components/shared/LearningVisuals";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/States";
import { PageHeader } from "@/components/shared/PageHeader";
import { Sheet } from "@/components/shared/Sheet";

type SortKey = "name" | "mastery" | "confidence" | "review";

export function PersonalModelPage() {
  const { currentLearner } = useAppStore();
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortKey>("mastery");
  const [ascending, setAscending] = useState(false);
  const [selected, setSelected] = useState<LearnerModelItem | null>(null);
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const query = useQuery({
    queryKey: queryKeys.model(currentLearner?.id ?? ""),
    queryFn: ({ signal }) => api.getLearnerModel(currentLearner!.id, signal),
    enabled: Boolean(currentLearner),
  });
  const evidence = useQuery({
    queryKey: queryKeys.evidence(currentLearner?.id ?? ""),
    queryFn: ({ signal }) =>
      api.getLearnerEvidence(currentLearner!.id, signal),
    enabled: Boolean(currentLearner),
  });
  const rows = useMemo(() => {
    const filtered = (query.data?.items ?? []).filter((item) => {
      const textMatch =
        !search.trim() ||
        item.knowledge_point.toLowerCase().includes(search.toLowerCase()) ||
        item.knowledge_point_id.includes(search.trim());
      const levelMatch =
        level === "all" || item.current_level === Number(level);
      const statusMatch =
        status === "all" ||
        (status === "misconception"
          ? item.critical_misconceptions.length > 0
          : status === item.prerequisite_status);
      return textMatch && levelMatch && statusMatch;
    });
    return [...filtered].sort((a, b) => {
      const factor = ascending ? 1 : -1;
      if (sort === "name")
        return factor * a.knowledge_point.localeCompare(b.knowledge_point);
      if (sort === "confidence") return factor * (a.confidence - b.confidence);
      if (sort === "review")
        return (
          factor *
          String(a.next_review_at ?? "").localeCompare(
            String(b.next_review_at ?? ""),
          )
        );
      return factor * (a.mastery_score - b.mastery_score);
    });
  }, [ascending, level, query.data?.items, search, sort, status]);
  if (!currentLearner) return <EmptyState title="尚未选择学习者" />;
  if (query.isLoading) return <LoadingState label="正在读取个人模型" />;
  if (query.isError)
    return (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    );
  const downloadCsv = async () => {
    try {
      const response = await api.downloadLearnerModelCsv(currentLearner.id);
      await triggerResponseDownload(response, `learner-${currentLearner.id}.csv`);
      setDownloadError(null);
    } catch (error) {
      setDownloadError(error);
    }
  };
  return (
    <div>
      <PageHeader
        eyebrow="Learner model"
        title="个人模型"
        description="知识点、认知层级、掌握度、置信度和前置状态均来自后端模型。"
        actions={
          <button
            type="button"
            onClick={() => void downloadCsv()}
            className="secondary-button"
          >
            <Download className="h-4 w-4" />
            下载 CSV
          </button>
        }
      />
      {downloadError !== null && (
        <div className="mb-4">
          <ErrorState error={downloadError} onRetry={() => void downloadCsv()} />
        </div>
      )}
      <div className="toolbar-card mb-4 grid gap-3 md:grid-cols-[minmax(14rem,1fr)_auto_auto_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-600 dark:text-slate-400" />
          <input
            aria-label="搜索个人模型知识点"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="form-input pl-9"
            placeholder="搜索知识点名称或 ID"
          />
        </div>
        <label className="flex min-w-0 items-center gap-2">
          <span className="text-xs text-slate-500">层级</span>
          <select
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            className="form-input min-w-0 flex-1 md:min-w-24"
          >
            <option value="all">全部</option>
            {[1, 2, 3, 4, 5, 6].map((item) => (
              <option key={item} value={item}>
                L{item}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400" />
          <select
            aria-label="前置状态"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="form-input min-w-0 flex-1 md:min-w-32"
          >
            <option value="all">全部状态</option>
            <option value="mastered">前置已掌握</option>
            <option value="not_mastered">前置未掌握</option>
            <option value="misconception">有误解</option>
          </select>
        </label>
        <label className="flex min-w-0 items-center gap-2">
          <SlidersHorizontal className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400" />
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="form-input min-w-0 flex-1 md:min-w-28"
            aria-label="排序字段"
          >
            <option value="mastery">掌握度</option>
            <option value="confidence">置信度</option>
            <option value="name">名称</option>
            <option value="review">复习时间</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => setAscending((value) => !value)}
          className="secondary-button"
          aria-label="切换排序方向"
        >
          {ascending ? (
            <ArrowUpAZ className="h-4 w-4" />
          ) : (
            <ArrowDownAZ className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">
            {ascending ? "升序" : "降序"}
          </span>
        </button>
      </div>
      <section className="surface-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 text-xs text-slate-500 dark:border-slate-800">
          <span>
            {rows.length} / {query.data?.items.length ?? 0} 个知识点
          </span>
          <span className="inline-flex items-center gap-1">
            <SlidersHorizontal className="h-3.5 w-3.5" />按 {sortLabel(sort)}
          </span>
        </div>
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="没有匹配的知识点"
              description="调整搜索或筛选条件，或者先完成一次学习对话。"
            />
          </div>
        ) : (
          <>
          <div className="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
            {rows.map((item) => (
              <button
                type="button"
                key={item.knowledge_point_id}
                onClick={() => setSelected(item)}
                className="block w-full px-4 py-4 text-left transition-colors hover:bg-indigo-50/60 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#3157D5]/45 dark:hover:bg-indigo-950/20"
                aria-label={`查看 ${item.knowledge_point} 的个人模型详情`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {item.knowledge_point}
                    </span>
                    <span className="mt-1 block truncate font-mono text-[10px] text-slate-500">
                      {item.knowledge_point_id}
                    </span>
                  </span>
                  <CognitiveBadge level={item.current_level} size="xs" />
                </span>
                <span className="mt-3 block">
                  <MasteryBar value={item.mastery_score} confidence={item.confidence} />
                </span>
                <span className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
                  <span>证据 {item.evidence_count} · {formatDate(item.next_review_at)}</span>
                  <span className="shrink-0 font-medium text-[#3157D5]">
                    {item.recommended_action}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800/60">
                <tr>
                  <th className="px-5 py-3 font-medium">知识点</th>
                  <th className="px-3 py-3 font-medium">认知层级</th>
                  <th className="px-3 py-3 font-medium">掌握度</th>
                  <th className="px-3 py-3 font-medium">置信度</th>
                  <th className="px-3 py-3 font-medium">证据</th>
                  <th className="px-3 py-3 font-medium">下次复习</th>
                  <th className="px-3 py-3 font-medium">推荐动作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((item) => (
                  <tr
                    key={item.knowledge_point_id}
                    className="hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20"
                  >
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        className="w-full rounded text-left focus:outline-none focus:ring-2 focus:ring-[#3157D5]/50"
                        onClick={() => setSelected(item)}
                        aria-label={`查看 ${item.knowledge_point} 的个人模型详情`}
                      >
                        <span className="block font-medium text-slate-800 dark:text-slate-100">
                          {item.knowledge_point}
                        </span>
                        <span className="mt-0.5 block font-mono text-[10px] text-slate-600 dark:text-slate-400">
                          {item.knowledge_point_id}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <CognitiveBadge level={item.current_level} size="xs" />
                    </td>
                    <td className="w-40 px-3 py-3">
                      <MasteryBar value={item.mastery_score} />
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {displayPercent(item.confidence)}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500">
                      {item.evidence_count}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500">
                      {formatDate(item.next_review_at)}
                    </td>
                    <td className="px-3 py-3 text-[11px] font-medium text-[#3157D5]">
                      {item.recommended_action}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>
      {selected && (
        <ModelDrawer
          item={selected}
          evidence={
            evidence.data?.items.filter(
              (entry) =>
                entry.knowledge_point_id === selected.knowledge_point_id,
            ) ?? []
          }
          evidenceLoading={evidence.isLoading}
          evidenceError={evidence.error}
          onRetryEvidence={() => void evidence.refetch()}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function sortLabel(sort: SortKey): string {
  return sort === "name"
    ? "名称"
    : sort === "mastery"
      ? "掌握度"
      : sort === "confidence"
        ? "置信度"
        : "复习时间";
}

function ModelDrawer({
  item,
  evidence,
  evidenceLoading,
  evidenceError,
  onRetryEvidence,
  onClose,
}: {
  item: LearnerModelItem;
  evidence: Array<{
    id: string;
    evidence_type: string;
    grader_explanation: string;
    created_at: string;
    observed_misconceptions: string[];
    correctness_score: number;
  }>;
  evidenceLoading: boolean;
  evidenceError: unknown;
  onRetryEvidence: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      eyebrow="知识点详情"
      title={item.knowledge_point}
      description={`${item.knowledge_point}的个人模型详情`}
    >
      <div className="mt-5 space-y-5">
          <CognitiveBadge level={item.current_level} size="md" />
          <MasteryBar value={item.mastery_score} confidence={item.confidence} />
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              前置知识
            </h3>
            {item.prerequisites.length ? (
              <div className="mt-2 space-y-2">
                {item.prerequisites.map((prerequisite) => (
                  <div
                    key={prerequisite.knowledge_point_id}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900"
                  >
                    <span>{prerequisite.knowledge_point}</span>
                    <span
                      className={
                        prerequisite.status === "mastered"
                          ? "text-emerald-600"
                          : "text-amber-600"
                      }
                    >
                      {prerequisite.status === "mastered" ? "已掌握" : "待补足"}{" "}
                      · {displayPercent(prerequisite.mastery_score)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                后端未返回前置知识。
              </p>
            )}
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              误解
            </h3>
            {item.critical_misconceptions.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-700 dark:text-red-300">
                {item.critical_misconceptions.map((misconception) => (
                  <li key={misconception}>{misconception}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">暂无记录。</p>
            )}
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              证据
            </h3>
            {evidenceLoading ? (
              <p className="mt-2 text-xs text-slate-500" role="status">
                正在读取掌握证据…
              </p>
            ) : evidenceError ? (
              <div className="mt-2">
                <ErrorState error={evidenceError} onRetry={onRetryEvidence} />
              </div>
            ) : evidence.length ? (
              <div className="mt-2 space-y-2">
                {evidence.slice(0, 8).map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-slate-100 p-3 text-xs dark:border-slate-800"
                  >
                    <div className="flex justify-between text-slate-500">
                      <span>{evidenceTypeLabel(entry.evidence_type)}</span>
                      <span>{formatDate(entry.created_at, true)}</span>
                    </div>
                    <p className="mt-1 leading-5 text-slate-600 dark:text-slate-300">
                      {entry.grader_explanation || "后端未提供解释。"}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">暂无证据。</p>
            )}
          </div>
      </div>
    </Sheet>
  );
}

function evidenceTypeLabel(value: string): string {
  return {
    RECOGNITION: "识别",
    WORKED_EXAMPLE: "例题",
    EXPLANATION: "解释",
    APPLICATION: "应用",
    TRANSFER: "迁移",
    CRITIQUE: "批判分析",
    CREATION: "创造",
    SELF_REPORT: "自我报告",
  }[value] ?? `其他证据：${value.toLowerCase().replaceAll("_", " ")}`;
}
