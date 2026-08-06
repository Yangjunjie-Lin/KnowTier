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
import { formatBytes, formatDate } from "@/lib/utils";
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

type Tab = "overview" | "chunks" | "knowledge";

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
  if (!documentId) return <EmptyState title="缺少 Document ID" />;
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
        eyebrow="Document detail"
        title={record.filename}
        description={`${record.mime_type} · ${formatBytes(record.byte_size)} · ${formatDate(record.created_at, true)}`}
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
              : record.status === "INGESTED"
                ? "重新摄取"
                : "开始摄取"}
          </button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2" aria-label="资料处理运行模型">
        <RuntimeModelBadge role="extractor" label="Extractor" />
        <RuntimeModelBadge role="embedding" label="Embedding" />
        <RuntimeModelBadge role="vision" label="Vision" />
      </div>
      {ingest.isPending && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          同步摄取正在运行。后端没有异步进度接口，页面不会显示虚构百分比。
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
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {(
          [
            { id: "overview", label: "概览", icon: FileText },
            { id: "chunks", label: "内容分块", icon: Table2 },
            { id: "knowledge", label: "抽取知识", icon: Braces },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm ${tab === item.id ? "border-[#3157D5] font-medium text-[#3157D5]" : "border-transparent text-slate-500"}`}
              aria-selected={tab === item.id}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </div>
      {tab === "overview" && <Overview record={record} />}
      {tab === "chunks" && <Chunks query={chunks} />}
      {tab === "knowledge" && <Knowledge query={knowledge} />}
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
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold">文件信息</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          {[
            ["状态", record.status],
            [
              "页数",
              record.page_count === null
                ? "后端未提供"
                : String(record.page_count),
            ],
            ["类型", record.mime_type],
            ["大小", formatBytes(record.byte_size)],
            ["SHA-256", record.sha256],
            ["创建时间", formatDate(record.created_at, true)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-slate-400">{label}</dt>
              <dd className="mt-1 break-all text-sm text-slate-700 dark:text-slate-200">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold">警告</h2>
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
            没有返回警告
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
        description="先完成一次摄取，或确认该 Document ID 属于当前 Workspace。"
      />
    );
  return (
    <div className="space-y-3">
      {items.map((chunk) => (
        <article
          key={chunk.id}
          className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
            <span className="font-mono">#{chunk.sequence}</span>
            <span>
              {chunk.page_start
                ? `p.${chunk.page_start}${chunk.page_end && chunk.page_end !== chunk.page_start ? `–${chunk.page_end}` : ""}`
                : "无页码"}{" "}
              · {chunk.token_count} tokens
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
        description="完成摄取后，后端会在可用时返回 Knowledge Blueprint。"
      />
    );
  return <KnowledgeBlueprintView value={blueprint} />;
}
