import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { navigationItems } from "./navigation";
import { useI18n } from "@/lib/i18n";

export function MobileBottomNav() {
  const location = useLocation();
  const { t } = useI18n();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200/80 bg-white/92 px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl lg:hidden dark:border-slate-800 dark:bg-slate-950/92"
      aria-label={t("shell.mobileNavigation")}
    >
      {navigationItems
        .filter((item) => item.mobile)
        .slice(0, 5)
        .map((item) => {
          const Icon = item.icon;
          const active =
            location.pathname === item.path ||
            (item.path !== "/" && location.pathname.startsWith(item.path));
          return (
            <NavLink
              key={item.key}
              to={item.path}
              className={cn(
                "group flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 text-[10px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3157D5]/45",
                active
                  ? "text-[#3157D5]"
                  : "text-slate-600 dark:text-slate-400",
              )}
              aria-current={active ? "page" : undefined}
            >
              <span
                className={cn(
                  "flex h-7 min-w-10 items-center justify-center rounded-xl px-2 transition-colors",
                  active && "bg-indigo-50 dark:bg-indigo-950/70",
                )}
              >
                <Icon className="h-[19px] w-[19px]" aria-hidden="true" />
              </span>
              <span className="max-w-full truncate px-0.5">{t(item.labelKey)}</span>
            </NavLink>
          );
        })}
    </nav>
  );
}
