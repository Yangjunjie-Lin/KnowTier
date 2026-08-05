import { LoaderCircle } from "lucide-react";

export function LoadingState({ label = "正在加载" }: { label?: string }) {
  return (
    <div
      className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-500"
      role="status"
    >
      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}
