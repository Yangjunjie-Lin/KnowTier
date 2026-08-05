import { Menu, UserRound } from "lucide-react";
import { useAppStore } from "@/stores/AppContext";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const { currentWorkspace, currentLearner } = useAppStore();
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
          <p className="truncate text-[11px] text-slate-400">
            {currentLearner
              ? `学习者：${currentLearner.display_name}`
              : "请先完成初始化"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <UserRound className="h-4 w-4" aria-hidden="true" />
        {currentLearner?.language ?? "zh-CN"}
      </div>
    </header>
  );
}
