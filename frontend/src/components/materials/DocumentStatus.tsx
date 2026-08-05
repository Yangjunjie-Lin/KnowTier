import { cn } from "@/lib/utils";

export function DocumentStatus({ status }: { status: string }) {
  const tone =
    status === "INGESTED"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
      : status === "FAILED"
        ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
        : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  return (
    <span className={cn("rounded-md px-2 py-1 text-[10px] font-medium", tone)}>
      {status}
    </span>
  );
}
