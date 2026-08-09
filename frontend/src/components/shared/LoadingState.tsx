import { LoaderCircle } from "lucide-react";

export function LoadingState({ label = "正在加载" }: { label?: string }) {
  return (
    <div
      className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200/70 bg-white/55 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400"
      role="status"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-[#3157D5] dark:bg-indigo-950/70 dark:text-indigo-300">
        <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
      </span>
      {label}
    </div>
  );
}
