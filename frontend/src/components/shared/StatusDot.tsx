import { cn } from "@/lib/utils";

export function StatusDot({ active = true }: { active?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        active ? "bg-emerald-500" : "bg-slate-300",
      )}
    >
      <span className="sr-only">{active ? "有效" : "历史"}</span>
    </span>
  );
}
