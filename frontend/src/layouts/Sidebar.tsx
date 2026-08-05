import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { navigationItems } from "./navigation";

export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const location = useLocation();
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden border-r border-slate-200 bg-white transition-[width] duration-200 dark:border-slate-800 dark:bg-slate-950 lg:flex lg:flex-col",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex h-16 items-center border-b border-slate-100 px-4 dark:border-slate-800",
          collapsed ? "justify-center" : "gap-3",
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#3157D5] text-sm font-bold text-white">
          K
        </div>
        {!collapsed && (
          <div>
            <p className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white">
              KnowTier
            </p>
            <p className="text-[10px] text-slate-400">认知学习工作台</p>
          </div>
        )}
      </div>
      <nav
        className="flex-1 space-y-1 overflow-y-auto px-2 py-4"
        aria-label="主导航"
      >
        {navigationItems.map((item) => {
          const active =
            location.pathname === item.path ||
            (item.key === "materials" &&
              location.pathname.startsWith("/materials/")) ||
            (item.key === "history" &&
              location.pathname.startsWith("/history"));
          const Icon = item.icon;
          return (
            <NavLink
              key={item.key}
              to={item.path}
              className={cn(
                "group flex items-center rounded-lg px-3 py-2.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#3157D5]/50",
                active
                  ? "bg-[#EEF2FF] font-medium text-[#3157D5] dark:bg-indigo-950/60 dark:text-indigo-300"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-white",
                collapsed ? "justify-center" : "gap-3",
              )}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>
      <button
        type="button"
        onClick={onToggle}
        className="m-2 flex items-center justify-center rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#3157D5]/50 dark:hover:bg-slate-900"
        aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
      >
        {collapsed ? (
          <PanelLeftOpen className="h-4 w-4" />
        ) : (
          <PanelLeftClose className="h-4 w-4" />
        )}
      </button>
    </aside>
  );
}
