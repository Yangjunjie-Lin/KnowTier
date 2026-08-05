import { CheckCircle2 } from "lucide-react";

export function PartialSuccess({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
      <CheckCircle2
        className="h-5 w-5 shrink-0 text-amber-600"
        aria-hidden="true"
      />
      <div>
        <p className="font-medium">{title}</p>
        <div className="mt-1 text-xs leading-5">{children}</div>
      </div>
    </div>
  );
}
