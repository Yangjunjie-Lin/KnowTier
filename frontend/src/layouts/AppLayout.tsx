import { NavLink, Outlet } from "react-router-dom";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { navigationItems } from "./navigation";
import { MobileBottomNav } from "./MobileBottomNav";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-screen bg-[#F6F7F9] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
      />
      <div
        className={cn(
          "min-h-screen transition-[margin] duration-200 lg:ml-60",
          collapsed && "lg:ml-16",
        )}
      >
        <TopBar onMenu={() => setMobileOpen((value) => !value)} />
        {mobileOpen && (
          <div
            className="fixed inset-0 z-20 bg-slate-900/30 lg:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <aside
              className="h-full w-72 bg-white p-4 shadow-xl dark:bg-slate-950"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-5 flex items-center justify-between">
                <span className="font-semibold">导航</span>
                <button
                  type="button"
                  className="rounded-md p-2 hover:bg-slate-100"
                  onClick={() => setMobileOpen(false)}
                  aria-label="关闭导航"
                >
                  ×
                </button>
              </div>
              <nav className="space-y-1">
                {navigationItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.key}
                      to={item.path}
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 dark:text-slate-300"
                    >
                      <Icon className="h-5 w-5" />
                      {item.label}
                    </NavLink>
                  );
                })}
              </nav>
            </aside>
          </div>
        )}
        <main className="mx-auto w-full max-w-[1600px] px-4 py-5 pb-24 sm:px-6 lg:px-8 lg:py-7 lg:pb-8">
          <Outlet />
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
