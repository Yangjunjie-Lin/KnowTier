import { Menu, Search, UserRound } from "lucide-react";
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/AppContext";

export function TopBar({
  onMenu,
  mobileOpen,
}: {
  onMenu: () => void;
  mobileOpen: boolean;
}) {
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
    <header className="sticky top-0 z-30 flex h-[68px] items-center justify-between border-b border-slate-200/80 bg-white/85 px-4 shadow-[0_1px_0_rgba(15,23,42,0.02)] backdrop-blur-xl sm:px-6 lg:px-8 dark:border-slate-800 dark:bg-slate-950/85">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onMenu}
          className="icon-button -ml-1 lg:hidden"
          aria-label={mobileOpen ? "关闭导航" : "打开导航"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
            {currentWorkspace?.name ?? "未选择 Workspace"}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
            {currentLearner
              ? `学习者：${currentLearner.display_name}`
              : "请先完成初始化"}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600 sm:gap-2 dark:text-slate-400">
        {currentWorkspace && currentLearner && (
          <Link
            to="/search"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-2.5 text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#3157D5]/40 sm:px-3 dark:border-slate-700 dark:bg-slate-900/70 dark:hover:bg-slate-900"
            aria-label="打开全局搜索"
            title="全局搜索（Ctrl/⌘ + K）"
          >
            <Search className="h-4 w-4" />
            <span className="hidden sm:inline">搜索</span>
          </Link>
        )}
        <span className="inline-flex h-10 items-center gap-2 rounded-xl px-2 text-slate-500 sm:bg-slate-100/70 sm:px-3 dark:sm:bg-slate-900">
          <UserRound className="h-4 w-4" aria-hidden="true" />
          <span className="hidden min-[360px]:inline">
            {currentLearner?.language ?? "zh-CN"}
          </span>
        </span>
      </div>
    </header>
  );
}
