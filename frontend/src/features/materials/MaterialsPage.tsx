import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
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
import { formatDate, isUuid } from "@/lib/utils";
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
        title="尚未选择 Workspace"
        description="连接 Workspace 后才能上传资料。"
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
        eyebrow="Knowledge library"
        title="资料库"
        description="上传和摄取分为两个真实步骤；最近记录仅保存在本设备。"
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
            upload.mutate(file);
          }
          event.target.value = "";
        }}
      />
      {upload.isPending && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200">
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
                    if (file) upload.mutate(file);
                  }
                : undefined
            }
          />
        </div>
      )}
      <div className="mb-5 grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-600 dark:text-slate-400" />
          <input
            aria-label="搜索最近资料"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索本设备最近资料或 Document ID"
            className="form-input pl-9"
          />
        </div>
        <div className="flex gap-2">
          <input
            aria-label="手动打开 Document UUID"
            value={manualId}
            onChange={(event) => setManualId(event.target.value)}
            placeholder="手动打开 UUID"
            className="form-input min-w-0 font-mono text-xs md:w-64"
          />
          <button
            type="button"
            onClick={openManual}
            className="secondary-button shrink-0"
          >
            <FolderOpen className="h-4 w-4" />
            打开
          </button>
        </div>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold">本设备最近上传</h2>
            <p className="mt-1 text-xs text-slate-500">
              后端当前没有 Document 列表接口，因此这里不伪造服务器列表。
            </p>
          </div>
          <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
            {docs.length} items
          </span>
        </div>
        {docs.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="暂无本设备记录"
              description="上传一个支持的文件，或手动输入已有 Document ID。"
            />
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-[#3157D5] dark:bg-indigo-950">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {doc.filename}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-slate-600 dark:text-slate-400">
                      {doc.id} · {doc.mimeType} ·{" "}
                      {formatDate(doc.createdAt, true)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <DocumentStatus status={doc.status} />
                  <span className="hidden sm:inline">本地记录</span>
                  <Link
                    to={`/materials/${doc.id}`}
                    onClick={() => selectDocument(doc.id)}
                    className="inline-flex items-center gap-1 text-[#3157D5]"
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
        PDF（是否启用 OCR 由后端运行配置决定）。
      </p>
    </div>
  );
}
