import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Brain,
  FileSearch,
  FileText,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/States";
import { PageHeader } from "@/components/shared/PageHeader";
import { queryKeys } from "@/lib/queryKeys";
import { api } from "@/services/api";
import { useAppStore } from "@/stores/AppContext";
import type { GlobalSearchResultKind } from "@/types/api";

const resultLabels: Record<GlobalSearchResultKind, string> = {
  knowledge: "知识图谱",
  material: "资料",
  material_content: "资料内容",
  learner_state: "个人模型",
};

const resultIcons = {
  knowledge: BookOpen,
  material: FileText,
  material_content: FileSearch,
  learner_state: Brain,
} satisfies Record<GlobalSearchResultKind, typeof Search>;

export function GlobalSearchPage() {
  const { currentWorkspace, currentLearner } = useAppStore();
  const [params, setParams] = useSearchParams();
  const query = (params.get("q") ?? "").trim();
  const [draft, setDraft] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(query), [query]);
  useEffect(() => inputRef.current?.focus(), []);
  const search = useQuery({
    queryKey: queryKeys.globalSearch(
      currentWorkspace?.id ?? "none",
      currentLearner?.id ?? "none",
      query,
    ),
    queryFn: ({ signal }) =>
      api.globalSearch(currentWorkspace!.id, currentLearner!.id, query, signal),
    enabled: Boolean(currentWorkspace && currentLearner && query.length >= 2),
    retry: false,
  });

  const submit = () => {
    const next = draft.trim();
    setParams(next.length >= 2 ? { q: next } : {});
  };

  return (
    <div>
      <PageHeader
        eyebrow="Global search"
        title="全局搜索"
        description="在当前 Workspace 的知识图谱、资料内容与个人模型中进行有边界的搜索。"
      />
      <form
        className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        role="search"
      >
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor="global-search-input">
          搜索知识、资料或学习状态
        </label>
        <div className="relative mt-2 flex gap-2">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <input
            id="global-search-input"
            ref={inputRef}
            className="form-input pl-9 pr-9"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="至少输入两个字符"
          />
          {draft && (
            <button
              type="button"
              className="absolute right-24 top-2 rounded-md p-1 text-slate-400 hover:text-slate-700"
              onClick={() => {
                setDraft("");
                setParams({});
                inputRef.current?.focus();
              }}
              aria-label="清空搜索"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button type="submit" className="primary-button shrink-0" disabled={draft.trim().length < 2}>
            搜索
          </button>
        </div>
      </form>

      <section className="mt-5" aria-live="polite" aria-label="全局搜索结果">
        {!query && (
          <EmptyState
            title="输入搜索词"
            description="搜索只在当前 Workspace 和学习者范围内执行。"
          />
        )}
        {query && query.length < 2 && (
          <EmptyState title="搜索词太短" description="请至少输入两个字符。" />
        )}
        {search.isLoading && <LoadingState label="正在搜索" />}
        {search.isError && (
          <ErrorState error={search.error} onRetry={() => void search.refetch()} />
        )}
        {search.data && search.data.items.length === 0 && (
          <EmptyState
            title="没有找到结果"
            description={`当前范围内没有与“${search.data.query}”匹配的内容。`}
          />
        )}
        {search.data && search.data.items.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              找到 {search.data.items.length} 项
              {search.data.truncated ? "，结果已按相关度截断" : ""}
            </p>
            {search.data.items.map((item) => {
              const Icon = resultIcons[item.kind];
              return (
                <Link
                  key={`${item.kind}-${item.id}`}
                  to={item.path}
                  className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 focus:outline-none focus:ring-2 focus:ring-[#3157D5]/50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/20"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-[#3157D5] dark:bg-indigo-950">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="text-[11px] font-medium text-[#3157D5]">
                      {resultLabels[item.kind]}
                    </span>
                    <span className="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {item.title}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">
                      {item.description}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
