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
import { useI18n } from "@/lib/i18n";

const resultLabels: Record<GlobalSearchResultKind, [string, string]> = {
  knowledge: ["知识点", "Knowledge point"],
  material: ["资料", "Material"],
  material_content: ["资料内容", "Material content"],
  learner_state: ["学习进展", "Learning progress"],
};

const resultIcons = {
  knowledge: BookOpen,
  material: FileText,
  material_content: FileSearch,
  learner_state: Brain,
} satisfies Record<GlobalSearchResultKind, typeof Search>;

export function GlobalSearchPage() {
  const { locale, pick, t } = useI18n();
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

  const pageHeader = (
    <PageHeader
      eyebrow={pick("快速查找", "Quick find")}
      title={t("nav.search")}
      description={pick(
        "一次搜索当前学习空间中的知识点、资料内容和个人学习状态。",
        "Search knowledge points, material content, and your learning progress in the current workspace.",
      )}
    />
  );

  if (!currentWorkspace || !currentLearner) {
    return (
      <div>
        {pageHeader}
        <EmptyState
          title={pick("还不能开始搜索", "Search is not ready yet")}
          description={pick("先选择学习空间和学习者，搜索结果才会限定在正确的数据范围内。", "Select a workspace and learner so results stay in the correct scope.")}
          action={
            <Link to="/init" className="primary-button">
              {pick("前往选择", "Choose workspace")}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      {pageHeader}
      <form
        className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        role="search"
      >
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor="global-search-input">
          {pick("搜索知识、资料或学习状态", "Search knowledge, materials, or progress")}
        </label>
        <div className="mt-2 flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              id="global-search-input"
              ref={inputRef}
              className="form-input min-w-0 pl-9 pr-9"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={pick("例如：检索增强生成", "For example: retrieval-augmented generation")}
              aria-describedby="global-search-help"
            />
            {draft && (
              <button
                type="button"
                className="absolute right-2 top-2 rounded-md p-1 text-slate-400 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#3157D5]/40"
                onClick={() => {
                  setDraft("");
                  setParams({});
                  inputRef.current?.focus();
                }}
                aria-label={pick("清空搜索", "Clear search")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button type="submit" className="primary-button shrink-0" disabled={draft.trim().length < 2}>
            {t("common.search")}
          </button>
        </div>
        <p id="global-search-help" className="mt-2 text-[11px] text-slate-500">
          {pick("输入至少两个字符，按 Enter 即可搜索。", "Enter at least two characters, then press Enter.")}
        </p>
      </form>

      <section className="mt-5" aria-live="polite" aria-label={pick("全局搜索结果", "Global search results")}>
        {!query && (
          <EmptyState
            title={pick("输入搜索词", "Enter a search term")}
            description={pick("可搜索知识点名称、资料正文和个人掌握状态。", "Search knowledge point names, material text, and personal mastery status.")}
          />
        )}
        {query && query.length < 2 && (
          <EmptyState title={pick("搜索词太短", "Search term is too short")} description={pick("请至少输入两个字符。", "Enter at least two characters.")} />
        )}
        {search.isLoading && <LoadingState label={pick("正在搜索", "Searching")} />}
        {search.isError && (
          <ErrorState error={search.error} onRetry={() => void search.refetch()} />
        )}
        {search.data && search.data.items.length === 0 && (
          <EmptyState
            title={pick("没有找到结果", "No results found")}
            description={pick(`当前范围内没有与“${search.data.query}”匹配的内容。`, `Nothing in the current scope matches “${search.data.query}”.`)}
            action={
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setDraft("");
                  setParams({});
                  inputRef.current?.focus();
                }}
              >
                {pick("清除搜索", "Clear search")}
              </button>
            }
          />
        )}
        {search.data && search.data.items.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {pick(`找到 ${search.data.items.length} 项`, `${search.data.items.length} results`)}
              {search.data.truncated ? pick("，仅显示最相关结果", "; showing the most relevant results") : ""}
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
                      {resultLabels[item.kind][locale === "en" ? 1 : 0]}
                    </span>
                    <span className="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {item.title}
                    </span>
                    <span className="mt-1 block break-words text-xs leading-5 text-slate-500">
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
