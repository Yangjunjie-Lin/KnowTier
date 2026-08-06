import { useQuery } from "@tanstack/react-query";
import { Cpu } from "lucide-react";
import { queryKeys } from "@/lib/queryKeys";
import { api } from "@/services/api";
import type { ModelRoleName } from "@/types/api";

export function RuntimeModelBadge({
  role,
  label,
}: {
  role: ModelRoleName;
  label?: string;
}) {
  const model = useQuery({
    queryKey: queryKeys.activeModel(role),
    queryFn: ({ signal }) => api.getActiveModel(role, signal),
    staleTime: 30_000,
    retry: false,
  });
  if (!model.data) return null;
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
      aria-label={`${label ?? role} 运行模型：${model.data.provider} ${model.data.model}`}
      title={`${model.data.profile_name} · ${model.data.provider} / ${model.data.model}`}
    >
      <Cpu className="h-3.5 w-3.5 shrink-0 text-[#3157D5]" />
      <span className="shrink-0 font-medium">{label ?? role}</span>
      <span className="truncate font-mono">
        {model.data.provider} / {model.data.model}
      </span>
    </span>
  );
}
