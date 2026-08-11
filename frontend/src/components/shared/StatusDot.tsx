import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export function StatusDot({ active = true }: { active?: boolean }) {
  const { pick } = useI18n();
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        active ? "bg-emerald-500" : "bg-slate-300",
      )}
    >
      <span className="sr-only">
        {active ? pick("当前有效", "Active") : pick("历史记录", "Historical")}
      </span>
    </span>
  );
}
