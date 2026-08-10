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
      id="desktop-sidebar"
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden border-r border-slate-200/80 bg-white/95 shadow-[8px_0_30px_rgba(15,23,42,0.025)] backdrop-blur-xl transition-[width] duration-200 dark:border-slate-800 dark:bg-slate-950/95 lg:flex lg:flex-col",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex h-[68px] items-center border-b border-slate-100 px-4 dark:border-slate-800",
          collapsed ? "justify-center" : "gap-3",
        )}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#3157D5] to-[#5577E8] text-sm font-bold text-white shadow-md shadow-indigo-500/20">
          K
        </div>
        {!collapsed && (
          <div>
            <p className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white">
              KnowTier
            </p>
            <p className="mt-0.5 text-[10px] tracking-wide text-slate-500 dark:text-slate-400">认知学习工作台</p>
          </div>
        )}
      </div>
      <nav
        id="desktop-primary-navigation"
        className="flex-1 space-y-1 overflow-y-auto px-2.5 py-5"
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
                "group relative flex min-h-11 items-center rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3157D5]/45",
                active
                  ? "bg-[#EEF2FF] text-[#3157D5] shadow-[inset_0_0_0_1px_rgba(49,87,213,0.04)] dark:bg-indigo-950/60 dark:text-indigo-300"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-white",
                collapsed ? "justify-center" : "gap-3",
              )}
              aria-current={active ? "page" : undefined}
              aria-label={collapsed ? item.label : undefined}
              title={collapsed ? item.label : undefined}
            >
              {active && !collapsed && (
                <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[#3157D5]" aria-hidden="true" />
              )}
              <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>
      <button
        type="button"
        onClick={onToggle}
        className="icon-button m-2 self-center"
        aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
        aria-controls="desktop-primary-navigation"
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
        ) : (
          <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </aside>
  );
}
