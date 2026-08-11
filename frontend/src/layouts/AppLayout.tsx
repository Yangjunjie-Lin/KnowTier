import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { navigationItems } from "./navigation";
import { MobileBottomNav } from "./MobileBottomNav";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { useI18n } from "@/lib/i18n";

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileNavigationRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const { t, pick } = useI18n();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const desktopViewport = window.matchMedia("(min-width: 1024px)");
    const closeAtDesktop = () => {
      if (!desktopViewport.matches) return;
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        mobileNavigationRef.current?.contains(activeElement)
      ) {
        activeElement.blur();
      }
      setMobileOpen(false);
    };
    closeAtDesktop();
    desktopViewport.addEventListener("change", closeAtDesktop);
    return () => desktopViewport.removeEventListener("change", closeAtDesktop);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
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
    document.documentElement.style.overflow = "hidden";
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
      document.documentElement.style.overflow = previousRootOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      if (
        previousFocus instanceof HTMLElement &&
        previousFocus.isConnected &&
        !window.matchMedia("(min-width: 1024px)").matches
      ) {
        previousFocus.focus();
      }
    };
  }, [mobileOpen]);

  const focusMainContent = (event: React.MouseEvent<HTMLAnchorElement>) => {
    const main = document.getElementById("main-content");
    if (!main) return;
    event.preventDefault();
    main.focus();
    main.scrollIntoView?.({ block: "start" });
  };

  return (
    <div className="relative isolate min-h-screen min-h-dvh overflow-x-clip bg-[#F5F7FB] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <a
        href="#main-content"
        onClick={focusMainContent}
        className="fixed left-3 top-3 z-[60] -translate-y-20 rounded-lg bg-[#3157D5] px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-[#3157D5] focus:ring-offset-2 dark:focus:ring-offset-slate-950"
      >
        {t("shell.skipToContent")}
      </a>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_78%_-20%,rgba(99,123,238,0.10),transparent_50%)] dark:opacity-30"
      />
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
      />
      <div
        data-testid="application-content-shell"
        data-sidebar-state={collapsed ? "collapsed" : "expanded"}
        className={cn(
          "relative min-h-screen min-h-dvh w-full min-w-0 transition-[padding-left] duration-200 ease-out motion-reduce:transition-none",
          collapsed ? "lg:pl-16" : "lg:pl-60",
        )}
      >
        <TopBar
          mobileOpen={mobileOpen}
          onMenu={() => setMobileOpen((value) => !value)}
        />
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 overscroll-contain bg-slate-950/45 backdrop-blur-[2px] lg:hidden"
            onClick={() => setMobileOpen(false)}
            role="presentation"
          >
            <aside
              ref={mobileNavigationRef}
              id="mobile-navigation"
              role="dialog"
              aria-modal="true"
              aria-labelledby="mobile-navigation-title"
              className="h-full max-h-dvh w-[min(19rem,86vw)] overflow-y-auto overscroll-contain border-r border-slate-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] shadow-2xl dark:border-slate-800 dark:bg-slate-950"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-6 flex items-center justify-between px-1">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#3157D5] to-[#5577E8] text-sm font-bold text-white shadow-md shadow-indigo-500/20">
                    K
                  </span>
                  <div>
                    <p
                      id="mobile-navigation-title"
                      className="text-sm font-semibold tracking-tight"
                    >
                      {pick("KnowTier 移动端主导航", "KnowTier mobile navigation")}
                    </p>
                    <p className="text-[11px] text-slate-500">{t("shell.productTagline")}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setMobileOpen(false)}
                  aria-label={t("shell.closeNavigation")}
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <nav className="space-y-1" aria-label={t("shell.primaryNavigation")}>
                {navigationItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.key}
                      to={item.path}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3157D5]/40",
                          isActive
                            ? "bg-indigo-50 text-[#3157D5] dark:bg-indigo-950/60 dark:text-indigo-300"
                            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900",
                        )
                      }
                    >
                      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                      {t(item.labelKey)}
                    </NavLink>
                  );
                })}
              </nav>
            </aside>
          </div>
        )}
        <main
          id="main-content"
          tabIndex={-1}
          className="w-full min-w-0 scroll-mt-20 px-4 py-5 pb-[calc(5.75rem+env(safe-area-inset-bottom))] focus:outline-none sm:px-6 sm:py-6 lg:px-8 lg:py-7 lg:pb-8 xl:px-10"
        >
          <Outlet />
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
