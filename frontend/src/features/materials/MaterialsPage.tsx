import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ChevronDown,
  FileText,
  FolderOpen,
  LoaderCircle,
  Search,
  UploadCloud,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/services/api";
import { queryKeys } from "@/lib/queryKeys";
import { formatDate, formatMimeType, isUuid } from "@/lib/utils";
import { useAppStore, documentsForWorkspace } from "@/stores/AppContext";
import {
  EmptyState,
  ErrorState,
} from "@/components/shared/States";
import { PageHeader } from "@/components/shared/PageHeader";
import { DocumentStatus } from "@/components/materials/DocumentStatus";

const accepted = ".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg,.tif,.tiff";

export function MaterialsPage() {
  const {
    currentWorkspace,
    recentDocuments,
    rememberDocument,
    selectDocument,
  } = useAppStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastUploadRef = useRef<File | null>(null);
  const [query, setQuery] = useState("");
  const [manualId, setManualId] = useState("");
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [errorSource, setErrorSource] = useState<"upload" | "manual" | null>(null);
  const docs = useMemo(
    () =>
      documentsForWorkspace(recentDocuments, currentWorkspace?.id).filter(
        (doc) =>
          !query.trim() ||
          doc.filename.toLowerCase().includes(query.toLowerCase()) ||
          doc.id.includes(query.trim()),
      ),
    [currentWorkspace?.id, query, recentDocuments],
  );
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadDocument(currentWorkspace!.id, file),
    onSuccess: (document) => {
      rememberDocument(document);
      selectDocument(document.id);
      setUploadError(null);
      setErrorSource(null);
      void queryClient.setQueryData(queryKeys.document(document.id), document);
      void navigate(`/materials/${document.id}`);
    },
    onError: (error) => {
      setUploadError(error);
      setErrorSource("upload");
    },
  });
  if (!currentWorkspace)
    return (
      <EmptyState
        title="尚未选择学习空间"
        description="连接学习空间后才能上传资料。"
        action={
          <Link to="/init" className="primary-button">
            去初始化
          </Link>
        }
      />
    );
  const openManual = () => {
    const id = manualId.trim();
    if (!isUuid(id)) {
      setUploadError(new Error("请输入有效的 Document UUID。"));
      setErrorSource("manual");
      return;
    }
    selectDocument(id);
    void navigate(`/materials/${id}`);
  };
  return (
    <div>
      <PageHeader
        eyebrow="资料管理"
        title="资料库"
        description="上传资料后即可提取知识并用于学习；最近打开记录保存在本设备。"
        actions={
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
            className="primary-button"
          >
            <UploadCloud className="h-4 w-4" />
            上传资料
          </button>
        }
      />
      <input
        ref={inputRef}
        type="file"
        accept={accepted}
        className="hidden"
        aria-label="选择要上传的资料"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            lastUploadRef.current = file;
            setUploadError(null);
            setErrorSource(null);
            upload.mutate(file);
          }
          event.target.value = "";
        }}
      />
      {upload.isPending && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200" role="status">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          正在上传文件…
        </div>
      )}
      {uploadError !== null && (
        <div className="mb-4">
          <ErrorState
            error={uploadError}
            onRetry={
              errorSource === "upload" && lastUploadRef.current
                ? () => {
                    const file = lastUploadRef.current;
                    if (file) {
                      setUploadError(null);
                      setErrorSource(null);
                      upload.mutate(file);
                    }
                  }
                : undefined
            }
          />
        </div>
      )}
      <div className="toolbar-card mb-5 grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-600 dark:text-slate-400" />
          <input
            aria-label="搜索最近资料"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索最近资料"
            className="form-input pl-9"
          />
        </div>
        <details className="group md:w-72">
          <summary className="secondary-button w-full cursor-pointer list-none justify-between [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2">
              <FolderOpen className="h-4 w-4" />
              按资料 ID 打开
            </span>
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-2 flex gap-2">
            <input
              aria-label="手动打开资料 UUID"
              value={manualId}
              onChange={(event) => setManualId(event.target.value)}
              placeholder="粘贴资料 UUID"
              className="form-input min-w-0 font-mono text-xs"
            />
            <button
              type="button"
              onClick={openManual}
              className="secondary-button shrink-0"
            >
              打开
            </button>
          </div>
        </details>
      </div>
      <section className="surface-card overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:items-center sm:px-5 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold">最近资料</h2>
            <p className="mt-1 text-xs text-slate-500">
              继续处理最近打开的资料，或在上方上传新文件。
            </p>
          </div>
          <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
            {docs.length} 份
          </span>
        </div>
        {docs.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title={query.trim() ? "没有匹配的资料" : "暂无本设备记录"}
              description={
                query.trim()
                  ? `最近资料中没有与“${query.trim()}”匹配的记录。`
                  : "上传一个支持的文件，或按资料 ID 打开已有资料。"
              }
              action={
                query.trim() ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setQuery("")}
                  >
                    清除搜索
                  </button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-slate-50/80 sm:flex-row sm:items-center sm:px-5 dark:hover:bg-slate-800/40"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-[#3157D5] ring-1 ring-indigo-100 dark:bg-indigo-950 dark:ring-indigo-900">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {doc.filename}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-600 dark:text-slate-400">
                      {formatMimeType(doc.mimeType)} · {formatDate(doc.createdAt, true)}
                      <span className="hidden font-mono sm:inline">
                        {` · ID ${doc.id.slice(0, 8)}`}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 sm:justify-end">
                  <DocumentStatus status={doc.status} />
                  <span className="hidden sm:inline">本地记录</span>
                  <Link
                    to={`/materials/${doc.id}`}
                    onClick={() => selectDocument(doc.id)}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-medium text-[#3157D5] hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-[#3157D5]/40 dark:hover:bg-indigo-950/50"
                  >
                    详情
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <p className="mt-4 text-[11px] text-slate-600 dark:text-slate-400">
        支持 PDF、DOCX、PPTX、TXT、Markdown、PNG、JPEG、TIFF 和扫描
        PDF；扫描件识别能力取决于当前 OCR 配置。
      </p>
    </div>
  );
}
