export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/65 px-6 py-10 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-slate-700 dark:bg-slate-900/40">
      <div
        aria-hidden="true"
        className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-lg font-medium text-indigo-600 ring-1 ring-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-900"
      >
        ∅
      </div>
      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </h3>
      {description && (
        <p className="mt-1.5 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
