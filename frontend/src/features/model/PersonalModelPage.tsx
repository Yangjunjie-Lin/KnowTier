import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  BookOpen,
  Download,
  Filter,
  LoaderCircle,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import { readableAction } from "@/lib/learningPath";
import { evidenceLabel, useI18n } from "@/lib/i18n";

type SortKey = "name" | "mastery" | "confidence" | "review";

export function PersonalModelPage() {
  const { locale, pick } = useI18n();
  const { currentLearner } = useAppStore();
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortKey>("mastery");
  const [ascending, setAscending] = useState(false);
  const [selected, setSelected] = useState<LearnerModelItem | null>(null);
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const [downloading, setDownloading] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.model(currentLearner?.id ?? ""),
    queryFn: ({ signal }) => api.getLearnerModel(currentLearner!.id, signal),
    enabled: Boolean(currentLearner),
  });
  const evidence = useQuery({
    queryKey: queryKeys.evidence(currentLearner?.id ?? ""),
    queryFn: ({ signal }) =>
      api.getLearnerEvidence(currentLearner!.id, signal),
    enabled: Boolean(currentLearner && selected),
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
  if (!currentLearner)
    return (
      <EmptyState
        title={pick("尚未选择学习者", "No learner selected")}
        description={pick("先选择学习者，才能查看个人掌握情况。", "Select a learner to view their progress.")}
        action={
          <Link to="/init" className="primary-button">
            {pick("选择学习者", "Select learner")}
          </Link>
        }
      />
    );
  if (query.isLoading) return <LoadingState label={pick("正在读取个人模型", "Loading learner progress")} />;
  if (query.isError)
    return (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    );
  const downloadCsv = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const response = await api.downloadLearnerModelCsv(currentLearner.id);
      await triggerResponseDownload(response, `learner-${currentLearner.id}.csv`);
      setDownloadError(null);
    } catch (error) {
      setDownloadError(error);
    } finally {
      setDownloading(false);
    }
  };
  if (!query.data?.items.length) {
    return (
      <div>
        <PageHeader
          eyebrow={pick("学习进展", "Learning progress")}
          title={pick("个人模型", "My progress")}
          description={pick("集中查看每个知识点的掌握程度、复习安排、误解与支持证据。", "Review mastery, confidence, misconceptions, evidence, and upcoming reviews for each topic.")}
        />
        <EmptyState
          title={pick("还没有学习记录", "No learning records yet")}
          description={pick("开始一次学习对话后，这里会持续更新掌握度与复习建议。", "Start a lesson to build mastery and review recommendations.")}
          action={
            <Link to="/learn" className="primary-button">
              {pick("开始学习", "Start learning")}
            </Link>
          }
        />
      </div>
    );
  }
  return (
    <div>
      <PageHeader
        eyebrow={pick("学习进展", "Learning progress")}
        title={pick("个人模型", "My progress")}
        description={pick("集中查看每个知识点的掌握程度、复习安排、误解与支持证据。", "Review mastery, confidence, misconceptions, evidence, and upcoming reviews for each topic.")}
        actions={
          <button
            type="button"
            onClick={() => void downloadCsv()}
            className="secondary-button"
            disabled={downloading}
          >
            {downloading ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {downloading ? pick("正在导出…", "Exporting…") : pick("导出学习数据", "Export learning data")}
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
            aria-label={pick("搜索个人模型知识点", "Search progress knowledge points")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="form-input pl-9"
            placeholder={pick("搜索知识点", "Search knowledge points")}
          />
        </div>
        <label className="flex min-w-0 items-center gap-2">
          <span className="text-xs text-slate-500">{pick("层级", "Level")}</span>
          <select
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            className="form-input min-w-0 flex-1 md:min-w-24"
          >
            <option value="all">{pick("全部", "All")}</option>
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
            aria-label={pick("前置状态", "Prerequisite status")}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="form-input min-w-0 flex-1 md:min-w-32"
          >
            <option value="all">{pick("全部状态", "All statuses")}</option>
            <option value="mastered">{pick("前置已掌握", "Prerequisites mastered")}</option>
            <option value="not_mastered">{pick("前置未掌握", "Prerequisites incomplete")}</option>
            <option value="misconception">{pick("有误解", "Has misconceptions")}</option>
          </select>
        </label>
        <label className="flex min-w-0 items-center gap-2">
          <SlidersHorizontal className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400" />
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="form-input min-w-0 flex-1 md:min-w-28"
            aria-label={pick("排序字段", "Sort field")}
          >
            <option value="mastery">{pick("掌握度", "Mastery")}</option>
            <option value="confidence">{pick("置信度", "Confidence")}</option>
            <option value="name">{pick("名称", "Name")}</option>
            <option value="review">{pick("复习时间", "Review date")}</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => setAscending((value) => !value)}
          className="secondary-button"
          aria-label={pick(`当前${ascending ? "升序" : "降序"}，切换排序方向`, `Currently ${ascending ? "ascending" : "descending"}; change sort direction`)}
        >
          {ascending ? (
            <ArrowUpAZ className="h-4 w-4" />
          ) : (
            <ArrowDownAZ className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">
            {ascending ? pick("升序", "Ascending") : pick("降序", "Descending")}
          </span>
        </button>
      </div>
      <section className="surface-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 text-xs text-slate-500 dark:border-slate-800">
          <span>
            {pick(`${rows.length} / ${query.data?.items.length ?? 0} 个知识点`, `${rows.length} / ${query.data?.items.length ?? 0} knowledge points`)}
          </span>
          <span className="inline-flex items-center gap-1">
            <SlidersHorizontal className="h-3.5 w-3.5" />{pick("按", "By")} {sortLabel(sort, locale)}
          </span>
        </div>
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title={pick("没有匹配的知识点", "No matching knowledge points")}
              description={pick("清除搜索词或筛选条件，再查看全部知识点。", "Clear the search or filters to see all knowledge points.")}
              action={
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setSearch("");
                    setLevel("all");
                    setStatus("all");
                  }}
                >
                  {pick("清除筛选", "Clear filters")}
                </button>
              }
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
                aria-label={pick(`查看 ${item.knowledge_point} 的个人模型详情`, `View progress details for ${item.knowledge_point}`)}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {item.knowledge_point}
                    </span>
                  </span>
                  <CognitiveBadge level={item.current_level} size="xs" />
                </span>
                <span className="mt-3 block">
                  <MasteryBar value={item.mastery_score} confidence={item.confidence} />
                </span>
                <span className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
                  <span>{pick("证据", "Evidence")} {item.evidence_count} · {formatDate(item.next_review_at, false, locale)}</span>
                  <span className="shrink-0 font-medium text-[#3157D5]">
                    {readableAction(item.recommended_action, locale)}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800/60">
                <tr>
                  <th className="px-5 py-3 font-medium">{pick("知识点", "Knowledge point")}</th>
                  <th className="px-3 py-3 font-medium">{pick("认知层级", "Cognitive level")}</th>
                  <th className="px-3 py-3 font-medium">{pick("掌握度", "Mastery")}</th>
                  <th className="px-3 py-3 font-medium">{pick("置信度", "Confidence")}</th>
                  <th className="px-3 py-3 font-medium">{pick("证据", "Evidence")}</th>
                  <th className="px-3 py-3 font-medium">{pick("下次复习", "Next review")}</th>
                  <th className="px-3 py-3 font-medium">{pick("推荐动作", "Recommended action")}</th>
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
                        aria-label={pick(`查看 ${item.knowledge_point} 的个人模型详情`, `View progress details for ${item.knowledge_point}`)}
                      >
                        <span className="block font-medium text-slate-800 dark:text-slate-100">
                          {item.knowledge_point}
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
                      {formatDate(item.next_review_at, false, locale)}
                    </td>
                    <td className="px-3 py-3 text-[11px] font-medium text-[#3157D5]">
                      {readableAction(item.recommended_action, locale)}
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

function sortLabel(sort: SortKey, locale: "zh-CN" | "en" = "zh-CN"): string {
  const en = locale === "en";
  return sort === "name"
    ? en ? "name" : "名称"
    : sort === "mastery"
      ? en ? "mastery" : "掌握度"
      : sort === "confidence"
        ? en ? "confidence" : "置信度"
        : en ? "review date" : "复习时间";
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
  const { locale, pick } = useI18n();
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      eyebrow={pick("知识点详情", "Knowledge point details")}
      title={item.knowledge_point}
      description={pick(`${item.knowledge_point}的个人模型详情`, `Progress details for ${item.knowledge_point}`)}
    >
      <div className="mt-5 space-y-5">
          <Link
            to="/learn"
            state={{
              learningTarget: {
                id: item.knowledge_point_id,
                name: item.knowledge_point,
                source: "personal-model",
              },
            }}
            className="primary-button w-full"
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            {item.critical_misconceptions.length > 0
              ? pick("复习并纠正误解", "Review and correct misconceptions")
              : pick("继续学习这个知识点", "Continue learning this topic")}
          </Link>
          <CognitiveBadge level={item.current_level} size="md" />
          <MasteryBar value={item.mastery_score} confidence={item.confidence} />
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {pick("前置知识", "Prerequisites")}
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
                      {prerequisite.status === "mastered" ? pick("已掌握", "Mastered") : pick("待补足", "Needs work")}{" "}
                      · {displayPercent(prerequisite.mastery_score)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                {pick("该知识点没有已记录的前置要求。", "This knowledge point has no recorded prerequisites.")}
              </p>
            )}
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {pick("误解", "Misconceptions")}
            </h3>
            {item.critical_misconceptions.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-700 dark:text-red-300">
                {item.critical_misconceptions.map((misconception) => (
                  <li key={misconception}>{misconception}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{pick("暂无记录。", "None recorded.")}</p>
            )}
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {pick("证据", "Evidence")}
            </h3>
            {evidenceLoading ? (
              <p className="mt-2 text-xs text-slate-500" role="status">
                {pick("正在读取掌握证据…", "Loading mastery evidence…")}
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
                      <span>{evidenceTypeLabel(entry.evidence_type, locale)}</span>
                      <span>{formatDate(entry.created_at, true, locale)}</span>
                    </div>
                    <p className="mt-1 leading-5 text-slate-600 dark:text-slate-300">
                      {entry.grader_explanation || pick("暂无评分说明。", "No grading explanation is available.")}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{pick("暂无证据。", "No evidence yet.")}</p>
            )}
          </div>
      </div>
    </Sheet>
  );
}

function evidenceTypeLabel(value: string, locale: "zh-CN" | "en"): string {
  const labels: Record<string, readonly [string, string]> = {
    RECOGNITION: ["识别", "Recognition"],
    WORKED_EXAMPLE: ["例题", "Worked example"],
    EXPLANATION: ["解释", "Explanation"],
    APPLICATION: ["应用", "Application"],
    TRANSFER: ["迁移", "Transfer"],
    CRITIQUE: ["批判分析", "Critical analysis"],
    CREATION: ["创造", "Creation"],
    SELF_REPORT: ["自我报告", "Self report"],
  };
  return labels[value]?.[locale === "en" ? 1 : 0] ?? evidenceLabel(value, locale);
}
