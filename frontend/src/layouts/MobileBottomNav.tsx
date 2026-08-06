import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { navigationItems } from "./navigation";

export function MobileBottomNav() {
  const location = useLocation();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-950/95"
      aria-label="移动端导航"
    >
      {navigationItems
        .filter((item) => item.mobile)
        .slice(0, 5)
        .map((item) => {
          const Icon = item.icon;
          const active =
            location.pathname === item.path ||
            (item.key === "materials" &&
              location.pathname.startsWith("/materials"));
          return (
            <NavLink
              key={item.key}
              to={item.path}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 text-[10px] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#3157D5]/50",
                active
                  ? "text-[#3157D5]"
                  : "text-slate-600 dark:text-slate-400",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
    </nav>
  );
}
