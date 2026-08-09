import { useQuery } from "@tanstack/react-query";
import { Cpu } from "lucide-react";
import { queryKeys } from "@/lib/queryKeys";
import { api } from "@/services/api";
import type { ModelRoleName } from "@/types/api";

function providerDisplayName(provider: string): string {
  if (provider === "mock") return "Mock Provider";
  if (provider === "siliconflow") return "SiliconFlow";
  if (provider === "openai_compatible") return "Custom OpenAI-Compatible";
  return provider;
}

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
  const accessibleLabel = label ?? role;
  if (!model.data) {
    const state = model.isError ? "暂时不可用" : "正在读取";
    return (
      <span
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
        aria-label={`${accessibleLabel} 运行模型：${state}`}
        role="status"
      >
        <Cpu className="h-3.5 w-3.5 shrink-0 text-[#3157D5]" />
        <span className="shrink-0 font-medium">{accessibleLabel}</span>
        <span>{state}</span>
      </span>
    );
  }
  const providerName = providerDisplayName(model.data.provider);
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
      aria-label={`${accessibleLabel} 运行模型：${providerName} ${model.data.model}`}
      title={`${model.data.profile_name} · ${providerName} / ${model.data.model}`}
    >
      <Cpu className="h-3.5 w-3.5 shrink-0 text-[#3157D5]" />
      <span className="shrink-0 font-medium">{accessibleLabel}</span>
      <span className="truncate font-mono">
        {providerName} / {model.data.model}
      </span>
    </span>
  );
}
