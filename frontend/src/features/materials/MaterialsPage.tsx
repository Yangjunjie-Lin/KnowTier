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
import { useI18n } from "@/lib/i18n";
import { UserFacingError } from "@/lib/api/errors";

const accepted = ".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg,.tif,.tiff";

export function MaterialsPage() {
  const { locale, pick, t } = useI18n();
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
        title={pick("尚未选择学习空间", "No workspace selected")}
        description={pick("连接学习空间后才能上传资料。", "Select a workspace before uploading materials.")}
        action={
          <Link to="/init" className="primary-button">
            {pick("去初始化", "Open setup")}
          </Link>
        }
      />
    );
  const openManual = () => {
    const id = manualId.trim();
    if (!isUuid(id)) {
      setUploadError(new UserFacingError(pick("请输入有效的资料标识。", "Enter a valid material identifier.")));
      setErrorSource("manual");
      return;
    }
    selectDocument(id);
    void navigate(`/materials/${id}`);
  };
  return (
    <div>
      <PageHeader
        eyebrow={pick("资料管理", "Learning materials")}
        title={t("nav.materials")}
        description={pick(
          "上传资料后即可提取知识并用于学习；最近打开记录保存在本设备。",
          "Upload a file to extract knowledge and use it in lessons. Recently opened materials are saved on this device.",
        )}
        actions={
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
            className="primary-button"
          >
            <UploadCloud className="h-4 w-4" />
            {pick("上传资料", "Upload material")}
          </button>
        }
      />
      <input
        ref={inputRef}
        type="file"
        accept={accepted}
        className="hidden"
        aria-label={pick("选择要上传的资料", "Choose a material to upload")}
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
          {pick("正在上传文件…", "Uploading file…")}
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
            aria-label={pick("搜索最近资料", "Search recent materials")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={pick("搜索最近资料", "Search recent materials")}
            className="form-input pl-9"
          />
        </div>
        <details className="group md:w-72">
          <summary className="secondary-button w-full cursor-pointer list-none justify-between [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2">
              <FolderOpen className="h-4 w-4" />
              {pick("按资料标识打开", "Open by material ID")}
            </span>
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-2 flex gap-2">
            <input
              aria-label={pick("手动打开资料标识", "Open a material by ID")}
              value={manualId}
              onChange={(event) => setManualId(event.target.value)}
              placeholder={pick("粘贴资料标识", "Paste material ID")}
              className="form-input min-w-0 font-mono text-xs"
            />
            <button
              type="button"
              onClick={openManual}
              className="secondary-button shrink-0"
            >
              {pick("打开", "Open")}
            </button>
          </div>
        </details>
      </div>
      <section className="surface-card overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:items-center sm:px-5 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold">{pick("最近资料", "Recent materials")}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {pick("继续处理最近打开的资料，或在上方上传新文件。", "Continue with a recent material or upload a new file above.")}
            </p>
          </div>
          <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
            {docs.length} {pick("份", docs.length === 1 ? "item" : "items")}
          </span>
        </div>
        {docs.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title={query.trim() ? pick("没有匹配的资料", "No matching materials") : pick("暂无本设备记录", "No recent materials")}
              description={
                query.trim()
                  ? pick(`最近资料中没有与“${query.trim()}”匹配的记录。`, `No recent material matches “${query.trim()}”.`)
                  : pick("上传一个支持的文件，或按资料标识打开已有资料。", "Upload a supported file or open an existing material by ID.")
              }
              action={
                query.trim() ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setQuery("")}
                  >
                    {pick("清除搜索", "Clear search")}
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
                      {formatMimeType(doc.mimeType, locale)} · {formatDate(doc.createdAt, true, locale)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 sm:justify-end">
                  <DocumentStatus status={doc.status} />
                  <span className="hidden sm:inline">{pick("本地记录", "Recent")}</span>
                  <Link
                    to={`/materials/${doc.id}`}
                    onClick={() => selectDocument(doc.id)}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-medium text-[#3157D5] hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-[#3157D5]/40 dark:hover:bg-indigo-950/50"
                  >
                    {t("common.details")}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <p className="mt-4 text-[11px] text-slate-600 dark:text-slate-400">
        {pick(
          "支持 PDF、DOCX、PPTX、TXT、Markdown、PNG、JPEG、TIFF 和扫描 PDF；扫描件识别能力取决于当前 OCR 配置。",
          "Supports PDF, DOCX, PPTX, TXT, Markdown, PNG, JPEG, TIFF, and scanned PDFs. Scan recognition depends on the current OCR configuration.",
        )}
      </p>
    </div>
  );
}
