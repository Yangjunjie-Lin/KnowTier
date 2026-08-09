import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { navigationItems } from "./navigation";
import { MobileBottomNav } from "./MobileBottomNav";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileNavigationRef = useRef<HTMLElement>(null);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        mobileNavigationRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    const focusFrame = window.requestAnimationFrame(() => {
      mobileNavigationRef.current
        ?.querySelector<HTMLElement>('button, a[href]')
        ?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [mobileOpen]);

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#F5F7FB] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_78%_-20%,rgba(99,123,238,0.10),transparent_50%)] dark:opacity-30"
      />
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
      />
      <div
        className={cn(
          "relative min-h-screen min-w-0 transition-[margin] duration-200 lg:ml-60",
          collapsed && "lg:ml-16",
        )}
      >
        <TopBar
          mobileOpen={mobileOpen}
          onMenu={() => setMobileOpen((value) => !value)}
        />
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[2px] lg:hidden"
            onClick={() => setMobileOpen(false)}
            role="presentation"
          >
            <aside
              ref={mobileNavigationRef}
              id="mobile-navigation"
              role="dialog"
              aria-modal="true"
              aria-label="移动端主导航"
              className="h-full w-[min(19rem,86vw)] border-r border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-950"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-6 flex items-center justify-between px-1">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#3157D5] to-[#5577E8] text-sm font-bold text-white shadow-md shadow-indigo-500/20">
                    K
                  </span>
                  <div>
                    <p className="text-sm font-semibold tracking-tight">KnowTier</p>
                    <p className="text-[11px] text-slate-500">认知学习工作台</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setMobileOpen(false)}
                  aria-label="关闭导航"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <nav className="space-y-1" aria-label="主导航">
                {navigationItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.key}
                      to={item.path}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#3157D5]/40",
                          isActive
                            ? "bg-indigo-50 text-[#3157D5] dark:bg-indigo-950/60 dark:text-indigo-300"
                            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900",
                        )
                      }
                    >
                      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                      {item.label}
                    </NavLink>
                  );
                })}
              </nav>
            </aside>
          </div>
        )}
        <main className="mx-auto w-full min-w-0 max-w-[1600px] px-4 py-5 pb-[calc(5.75rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-6 lg:px-8 lg:py-7 lg:pb-8 xl:px-10">
          <Outlet />
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
