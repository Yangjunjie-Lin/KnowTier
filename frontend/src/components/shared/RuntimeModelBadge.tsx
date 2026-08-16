import { useQuery } from "@tanstack/react-query";
import { Cpu } from "lucide-react";
import { queryKeys } from "@/lib/queryKeys";
import { api } from "@/services/api";
import type { ModelRoleName } from "@/types/api";
import { modelRoleLabel, providerLabel, useI18n } from "@/lib/i18n";

export function RuntimeModelBadge({
  role,
  label,
}: {
  role: ModelRoleName;
  label?: string;
}) {
  const { locale, pick } = useI18n();
  const model = useQuery({
    queryKey: queryKeys.activeModel(role),
    queryFn: ({ signal }) => api.getActiveModel(role, signal),
    staleTime: 30_000,
    retry: false,
  });
  const accessibleLabel = label && locale !== "en" ? label : modelRoleLabel(role, locale);
  if (!model.data) {
    const state = model.isError ? pick("暂时不可用", "Unavailable") : pick("正在读取", "Loading");
    return (
      <span
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
        aria-label={`${accessibleLabel}: ${state}`}
        role="status"
      >
        <Cpu className="h-3.5 w-3.5 shrink-0 text-[#3157D5]" />
        <span className="shrink-0 font-medium">{accessibleLabel}</span>
        <span>{state}</span>
      </span>
    );
  }
  const providerName = providerLabel(model.data.provider, locale);
  const isMock = model.data.provider.trim().toLowerCase().includes("mock");
  const mockNotice = pick(
    "离线演示，仅用于体验流程",
    "Offline demo for trying the workflow",
  );
  return (
    <span
      className={`inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
        isMock
          ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
          : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
      }`}
      aria-label={`${accessibleLabel}: ${providerName} ${model.data.model}${isMock ? `; ${mockNotice}` : ""}`}
      title={`${model.data.profile_name} · ${providerName} / ${model.data.model}${isMock ? ` · ${mockNotice}` : ""}`}
    >
      <Cpu className="h-3.5 w-3.5 shrink-0 text-[#3157D5]" />
      <span className="shrink-0 font-medium">{accessibleLabel}</span>
      <span className="truncate font-mono">
        {providerName} / {model.data.model}
      </span>
      {isMock && (
        <span className="font-sans font-medium">· {mockNotice}</span>
      )}
    </span>
  );
}
