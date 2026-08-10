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

type Tab = "overview" | "chunks" | "knowledge";

const documentTabs = [
  { id: "overview", label: "概览", icon: FileText },
  { id: "chunks", label: "内容分块", icon: Table2 },
  { id: "knowledge", label: "抽取知识", icon: Braces },
] as const;

export function DocumentDetailPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const { rememberDocument } = useAppStore();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const document = useQuery({
    queryKey: queryKeys.document(documentId ?? ""),
    queryFn: ({ signal }) => api.getDocument(documentId!, signal),
    enabled: Boolean(documentId),
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
  if (!documentId) return <EmptyState title="缺少资料 ID" />;
  if (document.isLoading) return <LoadingState label="正在读取资料" />;
  if (document.isError || !document.data)
    return (
      <ErrorState
        error={document.error ?? new Error("资料不存在")}
        onRetry={() => void document.refetch()}
      />
    );
  const record = document.data;
  return (
    <div>
      <Link
        to="/materials"
        className="mb-4 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-[#3157D5]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        返回资料库
      </Link>
      <PageHeader
        eyebrow="资料详情"
        title={record.filename}
        description={`${formatMimeType(record.mime_type)} · ${formatBytes(record.byte_size)} · ${formatDate(record.created_at, true)}`}
        actions={
          <button
            type="button"
            disabled={ingest.isPending || record.status === "PARSING"}
            onClick={() => ingest.mutate()}
            className="primary-button"
          >
            <Play className="h-4 w-4" />
            {ingest.isPending
              ? "摄取中…"
              : record.status === "PARSING"
                ? "正在处理…"
              : record.status === "INGESTED"
                ? "重新摄取"
                : "开始摄取"}
          </button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2" aria-label="资料处理运行模型">
        <RuntimeModelBadge role="extractor" label="知识抽取" />
        <RuntimeModelBadge role="embedding" label="向量检索" />
        <RuntimeModelBadge role="vision" label="图像识别" />
      </div>
      {ingest.isPending && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200" role="status">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          正在提取内容并更新知识索引，请保持应用开启。
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
          <PartialSuccess title="上次摄取失败">
            {record.warnings.join("；")}
          </PartialSuccess>
        </div>
      )}
      <div
        className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800"
        role="tablist"
        aria-label="资料详情视图"
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
              {item.label}
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
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold">文件信息</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          {[
            { label: "状态", value: <DocumentStatus status={record.status} /> },
            {
              label: "页数",
              value:
                record.page_count === null
                  ? "尚未生成"
                  : `${record.page_count} 页`,
            },
            { label: "类型", value: formatMimeType(record.mime_type) },
            { label: "大小", value: formatBytes(record.byte_size) },
            { label: "添加时间", value: formatDate(record.created_at, true) },
          ].map(({ label, value }) => (
            <div key={label}>
              <dt className="text-xs text-slate-400">{label}</dt>
              <dd className="mt-1 break-all text-sm text-slate-700 dark:text-slate-200">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <details className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
            技术信息
          </summary>
          <dl className="mt-3 space-y-3 font-mono text-[11px] text-slate-500 dark:text-slate-400">
            <div>
              <dt className="font-sans">资料 ID</dt>
              <dd className="mt-1 break-all">{record.id}</dd>
            </div>
            <div>
              <dt className="font-sans">MIME 类型</dt>
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
        <h2 className="text-base font-semibold">处理结果</h2>
        {record.warnings.length ? (
          <ul className="mt-3 space-y-2 text-sm text-amber-700">
            {record.warnings.map((warning) => (
              <li key={warning} className="flex gap-2">
                <span>·</span>
                {warning}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            处理正常，未发现需要处理的问题
          </p>
        )}
      </section>
    </div>
  );
}

function Chunks({ query }: { query: ReturnType<typeof useQuery> }) {
  if (query.isLoading) return <LoadingState label="正在读取内容分块" />;
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
        title="暂无内容分块"
        description="先完成一次摄取，或确认该资料属于当前学习空间。"
      />
    );
  return (
    <div className="space-y-3">
      {items.map((chunk) => (
        <article
          key={chunk.id}
          className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="mb-2 flex flex-col gap-1 text-[11px] text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-mono">#{chunk.sequence}</span>
            <span>
              {chunk.page_start
                ? `第 ${chunk.page_start}${chunk.page_end && chunk.page_end !== chunk.page_start ? `–${chunk.page_end}` : ""} 页`
                : "无页码"}{" "}
              · 约 {chunk.token_count} 个词元
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">
            {chunk.text}
          </p>
          {chunk.heading_path?.length > 0 && (
            <p className="mt-2 text-[11px] text-slate-400">
              {chunk.heading_path.join(" / ")}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}

function Knowledge({ query }: { query: ReturnType<typeof useQuery> }) {
  if (query.isLoading) return <LoadingState label="正在读取抽取知识" />;
  if (query.isError)
    return (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    );
  const blueprint = (query.data as { blueprint?: unknown } | undefined)
    ?.blueprint;
  if (!blueprint)
    return (
      <EmptyState
        title="暂无抽取知识"
        description="完成摄取后，这里会展示可用于学习和图谱构建的知识蓝图。"
      />
    );
  return <KnowledgeBlueprintView value={blueprint} />;
}
