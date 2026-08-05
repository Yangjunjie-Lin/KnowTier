import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { cognitiveLevels } from "./cognitiveLevels";

export function CognitiveLevelTrack({
  currentLevel,
  compact = false,
}: {
  currentLevel: number;
  compact?: boolean;
}) {
  return (
    <div
      className={cn("flex items-center", compact ? "gap-1" : "gap-2")}
      aria-label={`当前认知层级 L${currentLevel}`}
    >
      {cognitiveLevels.map((item, index) => (
        <div key={item.id} className="flex items-center">
          <div
            className={cn(
              "flex items-center justify-center rounded-full border-2 font-mono text-[10px] font-semibold transition-colors",
              compact ? "h-5 w-5" : "h-7 w-7",
            )}
            style={{
              color: index < currentLevel ? "#fff" : item.color,
              backgroundColor:
                index < currentLevel ? item.color : "transparent",
              borderColor: item.color,
            }}
          >
            {index < currentLevel ? (
              <Check className="h-3 w-3" aria-hidden="true" />
            ) : (
              item.id
            )}
          </div>
          {index < cognitiveLevels.length - 1 && (
            <div
              className={cn(compact ? "mx-0.5 w-2" : "mx-1 w-5", "h-px")}
              style={{
                backgroundColor:
                  index + 1 < currentLevel ? item.color : "#D9DEE9",
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
