import { Circle } from "lucide-react";
import { cognitiveLevels } from "./cognitiveLevels";

export function LevelIcon({ level }: { level: number }) {
  const item =
    cognitiveLevels[
      Math.max(0, Math.min(cognitiveLevels.length - 1, level - 1))
    ]!;
  return (
    <Circle
      className="h-3.5 w-3.5"
      style={{ fill: item.color, color: item.color }}
      aria-hidden="true"
    />
  );
}
