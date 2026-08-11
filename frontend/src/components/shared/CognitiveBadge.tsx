import { cn } from "@/lib/utils";
import { cognitiveLevels } from "./cognitiveLevels";
import { useI18n } from "@/lib/i18n";

export function CognitiveBadge({
  level,
  size = "sm",
}: {
  level: number;
  size?: "xs" | "sm" | "md";
}) {
  const { isEnglish } = useI18n();
  const item =
    cognitiveLevels[
      Math.max(0, Math.min(cognitiveLevels.length - 1, level - 1))
    ]!;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border font-medium",
        size === "xs"
          ? "px-1.5 py-0.5 text-[10px]"
          : size === "md"
            ? "px-2.5 py-1 text-sm"
            : "px-2 py-0.5 text-xs",
      )}
      style={{
        color: item.color,
        backgroundColor: item.soft,
        borderColor: `${item.color}45`,
      }}
    >
      <span className="font-mono">{item.code}</span>
      {isEnglish ? item.nameEn : item.name}
    </span>
  );
}
