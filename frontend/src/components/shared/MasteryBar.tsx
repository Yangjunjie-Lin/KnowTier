import { displayPercent, percent } from "@/lib/utils";

export function MasteryBar({
  value,
  confidence,
  label = "掌握度",
}: {
  value: number;
  confidence?: number;
  label?: string;
}) {
  const mastery = percent(value);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{label}</span>
        <span className="font-mono font-medium text-slate-700 dark:text-slate-200">
          {displayPercent(value)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className="h-full rounded-full bg-[#3157D5] transition-[width]"
          style={{ width: `${mastery}%` }}
        />
      </div>
      {confidence !== undefined && (
        <div className="text-[11px] text-slate-600 dark:text-slate-400">
          置信度 {displayPercent(confidence)}
        </div>
      )}
    </div>
  );
}
