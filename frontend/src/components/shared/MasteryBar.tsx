import { displayPercent, percent } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export function MasteryBar({
  value,
  confidence,
  label,
}: {
  value: number;
  confidence?: number;
  label?: string;
}) {
  const { pick } = useI18n();
  const mastery = percent(value);
  const displayLabel = label ?? pick("掌握度", "Mastery");
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{displayLabel}</span>
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
          {pick("置信度", "Confidence")} {displayPercent(confidence)}
        </div>
      )}
    </div>
  );
}
