import { Languages, Menu, Search } from "lucide-react";
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/AppContext";
import { useI18n } from "@/lib/i18n";

export function TopBar({
  onMenu,
  mobileOpen,
}: {
  onMenu: () => void;
  mobileOpen: boolean;
}) {
  const { currentWorkspace, currentLearner } = useAppStore();
  const { locale, setLocale, t } = useI18n();
  const navigate = useNavigate();
  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      const target = event.target;
      const editing =
        target instanceof Element
          ? target.closest('input, textarea, select, [contenteditable="true"]')
          : null;
      if (event.defaultPrevented || event.isComposing || event.repeat || editing)
        return;
      const slashShortcut =
        event.key === "/" && !event.altKey && !event.ctrlKey && !event.metaKey;
      const commandShortcut =
        event.key.toLowerCase() === "k" &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey;
      if (slashShortcut || commandShortcut) {
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
          aria-label={mobileOpen ? t("shell.closeNavigation") : t("shell.openNavigation")}
          aria-expanded={mobileOpen}
          aria-controls="mobile-navigation"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
            {currentWorkspace?.name ?? t("shell.noWorkspace")}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
            {currentLearner
              ? t("shell.learner", { name: currentLearner.display_name })
              : t("shell.finishSetup")}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600 sm:gap-2 dark:text-slate-400">
        {currentWorkspace && currentLearner && (
          <Link
            to="/search"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-2.5 text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3157D5]/40 sm:px-3 dark:border-slate-700 dark:bg-slate-900/70 dark:hover:bg-slate-900"
            aria-label={t("shell.openSearch")}
            title={t("shell.searchTitle")}
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t("common.search")}</span>
          </Link>
        )}
        <label className="inline-flex h-10 items-center gap-1.5 rounded-xl px-2 text-slate-500 sm:bg-slate-100/70 sm:px-3 dark:sm:bg-slate-900">
          <Languages className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="sr-only">{t("shell.interfaceLanguage")}</span>
          <select
            value={locale}
            onChange={(event) => setLocale(event.target.value === "en" ? "en" : "zh-CN")}
            className="max-w-[6.5rem] cursor-pointer bg-transparent text-xs font-medium text-slate-600 outline-none dark:text-slate-300"
            aria-label={t("shell.interfaceLanguage")}
          >
            <option value="zh-CN">{t("shell.languageChinese")}</option>
            <option value="en">{t("shell.languageEnglish")}</option>
          </select>
        </label>
      </div>
    </header>
  );
}
