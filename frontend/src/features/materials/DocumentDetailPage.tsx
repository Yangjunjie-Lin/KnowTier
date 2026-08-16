import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Braces,
  CheckCircle2,
  FileText,
  LoaderCircle,
  Play,
  Table2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/services/api";
import { queryKeys } from "@/lib/queryKeys";
import { formatBytes, formatDate, formatMimeType } from "@/lib/utils";
import { useAppStore } from "@/stores/AppContext";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PartialSuccess,
} from "@/components/shared/States";
import { PageHeader } from "@/components/shared/PageHeader";
import { RuntimeModelBadge } from "@/components/shared/RuntimeModelBadge";
import { IngestionSummary } from "@/components/materials/IngestionSummary";
import { KnowledgeBlueprintView } from "@/components/materials/KnowledgeBlueprintView";
import { DocumentStatus } from "@/components/materials/DocumentStatus";
import { useI18n } from "@/lib/i18n";
import { UserFacingError } from "@/lib/api/errors";

type Tab = "overview" | "chunks" | "knowledge";

const documentTabs = [
  { id: "overview", zh: "概览", en: "Overview", icon: FileText },
  { id: "chunks", zh: "资料内容", en: "Material content", icon: Table2 },
  { id: "knowledge", zh: "整理出的知识", en: "Organized knowledge", icon: Braces },
] as const;

export function DocumentDetailPage() {
  const { locale, pick } = useI18n();
  const { documentId } = useParams<{ documentId: string }>();
  const { rememberDocument } = useAppStore();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const document = useQuery({
    queryKey: queryKeys.document(documentId ?? ""),
    queryFn: ({ signal }) => api.getDocument(documentId!, signal),
    enabled: Boolean(documentId),
    refetchInterval: (query) =>
      query.state.data?.status === "PARSING" ? 2_000 : false,
  });
  useEffect(() => {
    if (document.data) rememberDocument(document.data);
  }, [document.data, rememberDocument]);
  const chunks = useQuery({
    queryKey: queryKeys.documentChunks(documentId ?? ""),
    queryFn: ({ signal }) => api.getDocumentChunks(documentId!, signal),
    enabled: Boolean(documentId) && tab === "chunks",
  });
  const knowledge = useQuery({
    queryKey: queryKeys.extractedKnowledge(documentId ?? ""),
    queryFn: ({ signal }) => api.getExtractedKnowledge(documentId!, signal),
    enabled: Boolean(documentId) && tab === "knowledge",
  });
  const ingest = useMutation({
    mutationFn: () => api.ingestDocument(documentId!),
    onSuccess: (report) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.document(documentId!),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.documentChunks(documentId!),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.extractedKnowledge(documentId!),
      });
      if (document.data)
        rememberDocument({
          ...document.data,
          status: "INGESTED",
          page_count: report.page_count,
        });
    },
    onError: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.document(documentId!),
      });
    },
  });
  if (!documentId) return <EmptyState title={pick("缺少资料标识", "Material identifier is missing")} />;
  if (document.isLoading) return <LoadingState label={pick("正在读取资料", "Loading material")} />;
  if (document.isError || !document.data)
    return (
      <ErrorState
        error={document.error ?? new UserFacingError(pick("资料不存在", "Material not found"))}
        onRetry={() => void document.refetch()}
      />
    );
  const record = document.data;
  const startAnalysis = () => {
    if (
      record.status === "INGESTED" &&
      !window.confirm(
        pick(
          "重新分析会再次整理资料中的知识并更新学习内容，可能消耗模型额度。要继续吗？",
          "Analyzing again will reorganize knowledge from the material and update learning content, and may use model quota. Continue?",
        ),
      )
    )
      return;
    ingest.mutate();
  };
  return (
    <div>
      <Link
        to="/materials"
        className="mb-4 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-[#3157D5]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {pick("返回资料库", "Back to materials")}
      </Link>
      <PageHeader
        eyebrow={pick("资料详情", "Material details")}
        title={record.filename}
        description={`${formatMimeType(record.mime_type, locale)} · ${formatBytes(record.byte_size)} · ${formatDate(record.created_at, true, locale)}`}
        actions={
          <button
            type="button"
            disabled={ingest.isPending || record.status === "PARSING"}
            onClick={startAnalysis}
            className={record.status === "INGESTED" ? "secondary-button" : "primary-button"}
          >
            <Play className="h-4 w-4" />
            {ingest.isPending
              ? pick("正在分析…", "Analyzing…")
              : record.status === "PARSING"
                ? pick("正在分析…", "Analyzing…")
              : record.status === "INGESTED"
                ? pick("重新分析资料", "Analyze again")
                : pick("分析资料并整理知识", "Analyze and organize knowledge")}
          </button>
        }
      />
      <details className="mb-4 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
        <summary className="cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-300">
          {pick("技术信息：本次处理使用的模型", "Technical: models used for processing")}
        </summary>
        <div className="mt-3 flex flex-wrap gap-2" aria-label={pick("资料处理运行模型", "Models used for material processing")}>
          <RuntimeModelBadge role="extractor" label={pick("知识整理", "Knowledge organization")} />
          <RuntimeModelBadge role="embedding" label={pick("内容查找", "Content retrieval")} />
          <RuntimeModelBadge role="vision" label={pick("图像识别", "Image understanding")} />
        </div>
      </details>
      {ingest.isPending && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200" role="status">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {pick("正在提取内容并更新知识索引，请保持应用开启。", "Extracting content and updating the knowledge index. Keep the app open.")}
        </div>
      )}
      {ingest.isError && (
        <div className="mb-4">
          <ErrorState error={ingest.error} onRetry={() => ingest.mutate()} />
        </div>
      )}
      {ingest.isSuccess && (
        <div className="mb-5">
          <IngestionSummary report={ingest.data} />
        </div>
      )}
      {record.status === "FAILED" && record.warnings.length > 0 && (
        <div className="mb-4">
          <PartialSuccess title={pick("上次资料分析失败", "The previous analysis failed")}>
            {record.warnings.join(pick("；", "; "))}
          </PartialSuccess>
        </div>
      )}
      <div
        className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:border-slate-800"
        role="tablist"
        aria-label={pick("资料详情视图", "Material detail views")}
      >
        {documentTabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.id}
              id={`document-tab-${item.id}`}
              role="tab"
              onClick={() => setTab(item.id)}
              onKeyDown={(event) => {
                const currentIndex = documentTabs.findIndex(
                  (candidate) => candidate.id === item.id,
                );
                const requestedIndex =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? documentTabs.length - 1
                      : event.key === "ArrowRight"
                        ? (currentIndex + 1) % documentTabs.length
                        : event.key === "ArrowLeft"
                          ? (currentIndex - 1 + documentTabs.length) %
                            documentTabs.length
                          : null;
                if (requestedIndex === null) return;
                event.preventDefault();
                const requestedTab = documentTabs[requestedIndex]!;
                setTab(requestedTab.id);
                window.document
                  .getElementById(`document-tab-${requestedTab.id}`)
                  ?.focus();
              }}
              className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm ${tab === item.id ? "border-[#3157D5] font-medium text-[#3157D5]" : "border-transparent text-slate-500"}`}
              aria-selected={tab === item.id}
              aria-controls="document-tab-panel"
              tabIndex={tab === item.id ? 0 : -1}
            >
              <Icon className="h-4 w-4" />
              {pick(item.zh, item.en)}
            </button>
          );
        })}
      </div>
      <div
        id="document-tab-panel"
        role="tabpanel"
        aria-labelledby={`document-tab-${tab}`}
        tabIndex={0}
        className="focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3157D5]/40"
      >
        {tab === "overview" && <Overview record={record} />}
        {tab === "chunks" && <Chunks query={chunks} />}
        {tab === "knowledge" && <Knowledge query={knowledge} />}
      </div>
    </div>
  );
}

function Overview({
  record,
}: {
  record: NonNullable<ReturnType<typeof useQuery>["data"]> extends never
    ? never
    : {
        id: string;
        status: string;
        page_count: number | null;
        sha256: string;
        warnings: string[];
        created_at: string;
        mime_type: string;
        byte_size: number;
        workspace_id: string;
        filename: string;
      };
}) {
  const { locale, pick } = useI18n();
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold">{pick("文件信息", "File information")}</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          {[
            { label: pick("状态", "Status"), value: <DocumentStatus status={record.status} /> },
            {
              label: pick("页数", "Pages"),
              value:
                record.page_count === null
                  ? pick("尚未生成", "Not available yet")
                  : pick(`${record.page_count} 页`, `${record.page_count} pages`),
            },
            { label: pick("类型", "Type"), value: formatMimeType(record.mime_type, locale) },
            { label: pick("大小", "Size"), value: formatBytes(record.byte_size) },
            { label: pick("添加时间", "Added"), value: formatDate(record.created_at, true, locale) },
          ].map(({ label, value }) => (
            <div key={label}>
              <dt className="text-xs text-slate-600 dark:text-slate-400">{label}</dt>
              <dd className="mt-1 break-all text-sm text-slate-700 dark:text-slate-200">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <details className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
            {pick("技术信息", "Technical information")}
          </summary>
          <dl className="mt-3 space-y-3 font-mono text-[11px] text-slate-500 dark:text-slate-400">
            <div>
              <dt className="font-sans">{pick("资料 ID", "Material ID")}</dt>
              <dd className="mt-1 break-all">{record.id}</dd>
            </div>
            <div>
              <dt className="font-sans">{pick("MIME 类型", "MIME type")}</dt>
              <dd className="mt-1 break-all">{record.mime_type}</dd>
            </div>
            <div>
              <dt className="font-sans">SHA-256</dt>
              <dd className="mt-1 break-all">{record.sha256}</dd>
            </div>
          </dl>
        </details>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold">{pick("处理结果", "Processing result")}</h2>
        {record.warnings.length ? (
          <ul className="mt-3 space-y-2 text-sm text-amber-700">
            {record.warnings.map((warning) => (
              <li key={warning} className="flex gap-2">
                <span>·</span>
                {warning}
              </li>
            ))}
          </ul>
        ) : record.status === "INGESTED" ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            {pick("资料分析完成，未发现需要处理的问题", "Analysis completed with no issues requiring attention")}
          </p>
        ) : record.status === "FAILED" ? (
          <p className="mt-3 text-sm leading-6 text-red-700 dark:text-red-300">
            {pick("资料分析未完成，请使用上方按钮重试。", "Analysis did not finish. Use the button above to try again.")}
          </p>
        ) : record.status === "PARSING" ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-indigo-700 dark:text-indigo-300" role="status">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {pick("正在分析资料，页面会自动更新。", "Analyzing the material. This page will update automatically.")}
          </p>
        ) : (
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {pick("尚未分析。点击“分析资料并整理知识”后可查看处理结果。", "Not analyzed yet. Select “Analyze and organize knowledge” to see results.")}
          </p>
        )}
      </section>
    </div>
  );
}

function Chunks({ query }: { query: ReturnType<typeof useQuery> }) {
  const { pick } = useI18n();
  if (query.isLoading) return <LoadingState label={pick("正在读取资料内容", "Loading material content")} />;
  if (query.isError)
    return (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    );
  const items =
    (
      query.data as
        | {
            items?: Array<{
              id: string;
              sequence: number;
              text: string;
              page_start: number | null;
              page_end: number | null;
              heading_path: string[];
              token_count: number;
            }>;
          }
        | undefined
    )?.items ?? [];
  if (!items.length)
    return (
      <EmptyState
        title={pick("暂无可查看内容", "No material content yet")}
        description={pick("请先分析这份资料，或确认它属于当前学习空间。", "Analyze this material first, or confirm it belongs to the current workspace.")}
      />
    );
  return (
    <div className="space-y-3">
      {items.map((chunk) => (
        <article
          key={chunk.id}
          className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="mb-2 flex flex-col gap-1 text-[11px] text-slate-600 sm:flex-row sm:items-center sm:justify-between dark:text-slate-400">
            <span className="font-mono">#{chunk.sequence}</span>
            <span>
              {chunk.page_start
                ? pick(`第 ${chunk.page_start}${chunk.page_end && chunk.page_end !== chunk.page_start ? `–${chunk.page_end}` : ""} 页`, `Page ${chunk.page_start}${chunk.page_end && chunk.page_end !== chunk.page_start ? `–${chunk.page_end}` : ""}`)
                : pick("无页码", "No page number")}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">
            {chunk.text}
          </p>
          {chunk.heading_path?.length > 0 && (
            <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-400">
              {chunk.heading_path.join(" / ")}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}

function Knowledge({ query }: { query: ReturnType<typeof useQuery> }) {
  const { pick } = useI18n();
  if (query.isLoading) return <LoadingState label={pick("正在读取整理出的知识", "Loading organized knowledge")} />;
  if (query.isError)
    return (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    );
  const blueprint = (query.data as { blueprint?: unknown } | undefined)
    ?.blueprint;
  if (!blueprint)
    return (
      <EmptyState
        title={pick("暂无整理出的知识", "No organized knowledge yet")}
        description={pick("完成资料分析后，这里会展示可用于学习和知识地图的内容结构。", "After analysis, a learning-ready content structure will appear here.")}
      />
    );
  return <KnowledgeBlueprintView value={blueprint} />;
}
