import { Menu, Search, UserRound } from "lucide-react";
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/AppContext";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const { currentWorkspace, currentLearner } = useAppStore();
  const navigate = useNavigate();
  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (editing) return;
      if (event.key === "/" || (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey))) {
        event.preventDefault();
        void navigate("/search");
      }
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, [navigate]);
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:px-7 dark:border-slate-800 dark:bg-slate-950/95">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onMenu}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#3157D5]/50 lg:hidden"
          aria-label="打开导航"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
            {currentWorkspace?.name ?? "未选择 Workspace"}
          </p>
          <p className="truncate text-[11px] text-slate-600 dark:text-slate-400">
            {currentLearner
              ? `学习者：${currentLearner.display_name}`
              : "请先完成初始化"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
        {currentWorkspace && currentLearner && (
          <Link
            to="/search"
            className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 px-2.5 text-slate-500 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#3157D5]/50 dark:border-slate-700 dark:hover:bg-slate-900"
            aria-label="打开全局搜索"
            title="全局搜索（Ctrl/⌘ + K）"
          >
            <Search className="h-4 w-4" />
            <span className="hidden sm:inline">搜索</span>
          </Link>
        )}
        <UserRound className="h-4 w-4" aria-hidden="true" />
        {currentLearner?.language ?? "zh-CN"}
      </div>
    </header>
  );
}
