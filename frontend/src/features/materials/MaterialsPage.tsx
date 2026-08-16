import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowRight,
  ChevronDown,
  FileText,
  FolderOpen,
  HardDrive,
  LoaderCircle,
  Search,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/services/api";
import { queryKeys } from "@/lib/queryKeys";
import { formatDate, formatMimeType, isUuid } from "@/lib/utils";
import { useAppStore, documentsForWorkspace } from "@/stores/AppContext";
import { recentDocumentFrom } from "@/types/app";
import {
  EmptyState,
  ErrorState,
} from "@/components/shared/States";
import { PageHeader } from "@/components/shared/PageHeader";
import { DocumentStatus } from "@/components/materials/DocumentStatus";
import { useI18n } from "@/lib/i18n";
import { UserFacingError, isApiError } from "@/lib/api/errors";
import {
  materialFileAccept,
  validateMaterialFile,
  type MaterialFileIssue,
} from "@/lib/materialFiles";

function materialIssueMessage(
  issue: MaterialFileIssue,
  pick: (zh: string, en: string) => string,
): string {
  if (issue === "unsupported") {
    return pick(
      "暂不支持这种文件。请选择 PDF、Word、PPT、文本、Markdown 或常见图片。",
      "This file type is not supported. Choose a PDF, Word file, slide deck, text, Markdown, or common image.",
    );
  }
  if (issue === "empty") {
    return pick(
      "这个文件是空的，请选择包含内容的资料。",
      "This file is empty. Choose a material that contains content.",
    );
  }
  return pick(
    "单个文件不能超过 25 MB，请选择较小的资料。",
    "A material cannot exceed 25 MB. Choose a smaller file.",
  );
}

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
  const dragDepthRef = useRef(0);
  const [query, setQuery] = useState("");
  const [manualId, setManualId] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [errorSource, setErrorSource] = useState<"upload" | "manual" | null>(null);
  const documentsQuery = useInfiniteQuery({
    queryKey: queryKeys.documents(currentWorkspace?.id ?? "none"),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      api.listDocuments(currentWorkspace!.id, signal, pageParam),
    getNextPageParam: (lastPage) => lastPage.next_offset ?? undefined,
    enabled: Boolean(currentWorkspace),
    staleTime: 15_000,
  });
  const docs = useMemo(
    () => {
      const serverDocuments =
        documentsQuery.data?.pages
          .flatMap((page) => page.items)
          .map(recentDocumentFrom) ?? [];
      const localDocuments = documentsForWorkspace(
        recentDocuments,
        currentWorkspace?.id,
      );
      const serverIds = new Set(serverDocuments.map((document) => document.id));
      return [
        ...serverDocuments,
        ...localDocuments.filter((document) => !serverIds.has(document.id)),
      ].filter(
        (doc) =>
          !query.trim() ||
          doc.filename.toLowerCase().includes(query.toLowerCase()) ||
          doc.id.includes(query.trim()),
      );
    },
    [
      currentWorkspace?.id,
      documentsQuery.data?.pages,
      query,
      recentDocuments,
    ],
  );
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadDocument(currentWorkspace!.id, file),
    onSuccess: (document) => {
      rememberDocument(document);
      selectDocument(document.id);
      setUploadError(null);
      setErrorSource(null);
      void queryClient.setQueryData(queryKeys.document(document.id), document);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.documents(document.workspace_id),
      });
      void navigate(`/materials/${document.id}`);
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 422) {
        lastUploadRef.current = null;
        setUploadError(
          new UserFacingError(
            pick(
              "这份资料未通过文件校验，请重新选择文件。",
              "This material did not pass file validation. Choose another file.",
            ),
          ),
        );
      } else {
        setUploadError(error);
      }
      setErrorSource("upload");
    },
  });
  const beginUpload = (file: File) => {
    const issue = validateMaterialFile(file);
    if (issue) {
      lastUploadRef.current = null;
      setUploadError(new UserFacingError(materialIssueMessage(issue, pick)));
      setErrorSource("upload");
      return;
    }
    lastUploadRef.current = file;
    setUploadError(null);
    setErrorSource(null);
    upload.mutate(file);
  };
  const keepDropActive = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
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
          "这里显示当前学习主题中已保存的资料；清除本机浏览记录也不会删除它们。",
          "This shows materials saved in the current learning topic. Clearing local browser history does not delete them.",
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
        accept={materialFileAccept}
        className="hidden"
        aria-label={pick("选择要上传的资料", "Choose a material to upload")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) beginUpload(file);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        data-testid="material-drop-zone"
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          keepDropActive(event);
          dragDepthRef.current += 1;
          setDragging(true);
        }}
        onDragOver={keepDropActive}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepthRef.current = 0;
          setDragging(false);
          const file = event.dataTransfer.files.item(0);
          if (file && !upload.isPending) beginUpload(file);
        }}
        disabled={upload.isPending}
        className={`group mb-5 flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-7 text-center transition-[border-color,background-color,transform] focus:outline-none focus:ring-2 focus:ring-[#3157D5]/40 disabled:cursor-wait disabled:opacity-70 ${
          dragging
            ? "scale-[1.01] border-[#3157D5] bg-indigo-50 dark:bg-indigo-950/35"
            : "border-slate-300 bg-white/70 hover:border-indigo-400 hover:bg-indigo-50/50 dark:border-slate-700 dark:bg-slate-900/70 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/20"
        }`}
        aria-describedby="material-upload-help"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-[#3157D5] transition-transform group-hover:-translate-y-0.5 dark:bg-indigo-950 dark:text-indigo-300">
          {upload.isPending ? (
            <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden="true" />
          ) : (
            <UploadCloud className="h-6 w-6" aria-hidden="true" />
          )}
        </span>
        <span className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">
          {upload.isPending
            ? pick("正在添加资料…", "Adding material…")
            : dragging
              ? pick("松开即可添加这份资料", "Drop to add this material")
              : pick("拖放资料到这里，或点击选择文件", "Drop a material here, or click to choose a file")}
        </span>
        <span id="material-upload-help" className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
          {pick(
            "支持课件、讲义、笔记和常见图片，单个文件不超过 25 MB。添加后会先预览处理结果，再用于学习。",
            "Supports slides, documents, notes, and common images up to 25 MB each. You can review processing results before using the material in a lesson.",
          )}
        </span>
        <span className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
            {pick("保存在当前学习空间", "Saved in this workspace")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {pick("回答可追溯到资料来源", "Answers stay linked to sources")}
          </span>
        </span>
      </button>
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
      {documentsQuery.isError && (
        <div className="mb-4">
          <ErrorState
            error={documentsQuery.error}
            onRetry={() => void documentsQuery.refetch()}
          />
        </div>
      )}
      <div className="toolbar-card mb-5 grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-600 dark:text-slate-400" />
          <input
            aria-label={pick("搜索当前主题资料", "Search saved materials")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={pick("搜索当前主题资料", "Search saved materials")}
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
            <h2 className="text-base font-semibold">{pick("当前主题资料", "Saved materials")}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {pick("服务端保存记录与本机最近打开记录会自动合并。", "Saved records and recently opened local records are combined automatically.")}
            </p>
          </div>
          <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
            {documentsQuery.isError && docs.length === 0
              ? pick("数量未知", "Count unavailable")
              : documentsQuery.hasNextPage
                ? pick(`已加载 ${docs.length} 份`, `${docs.length} loaded`)
                : `${docs.length} ${pick("份", docs.length === 1 ? "item" : "items")}`}
          </span>
        </div>
        {documentsQuery.isPending && docs.length === 0 ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500" role="status">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            {pick("正在读取已保存的资料…", "Loading saved materials…")}
          </div>
        ) : documentsQuery.isError && docs.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500" role="status">
            {pick(
              "资料列表尚未成功读取，无法确认这个主题是否为空。请使用上方“重试”。",
              "The material list could not be loaded, so this topic may not be empty. Use Retry above.",
            )}
          </div>
        ) : docs.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title={
                documentsQuery.hasNextPage
                  ? pick("已加载资料中没有匹配项", "No match in loaded materials")
                  : query.trim()
                    ? pick("没有匹配的资料", "No matching materials")
                    : pick("这个主题还没有资料", "No materials in this topic")
              }
              description={
                documentsQuery.hasNextPage
                  ? pick(
                      "还有更早的资料尚未加载，可继续加载后再搜索。",
                      "Older materials have not been loaded yet. Load more and search again.",
                    )
                  : query.trim()
                  ? pick(`当前资料中没有与“${query.trim()}”匹配的记录。`, `No saved material matches “${query.trim()}”.`)
                  : pick("上传一个支持的文件，或按资料标识打开已有资料。", "Upload a supported file or open an existing material by ID.")
              }
              action={
                documentsQuery.hasNextPage ? (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={documentsQuery.isFetchingNextPage}
                    onClick={() => void documentsQuery.fetchNextPage()}
                  >
                    {pick("加载更多资料", "Load more materials")}
                  </button>
                ) : query.trim() ? (
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
          <>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {docs.map((doc) => (
              <div
                key={doc.id}
                className="flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-slate-50/80 sm:flex-row sm:items-center sm:px-5 dark:hover:bg-slate-800/40"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-[#3157D5] ring-1 ring-indigo-100 dark:bg-indigo-950 dark:ring-indigo-900">
                    <FileText className="h-4 w-4" aria-hidden="true" />
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
                  <span className="hidden sm:inline">{pick("已保存", "Saved")}</span>
                  <Link
                    to={`/materials/${doc.id}`}
                    onClick={() => selectDocument(doc.id)}
                    aria-label={pick(
                      `查看 ${doc.filename} 的详情`,
                      `View details for ${doc.filename}`,
                    )}
                    className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 font-medium text-[#3157D5] hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-[#3157D5]/40 dark:hover:bg-indigo-950/50"
                  >
                    {t("common.details")}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
              ))}
            </div>
            {documentsQuery.hasNextPage && (
              <div className="border-t border-slate-100 p-4 text-center dark:border-slate-800">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={documentsQuery.isFetchingNextPage}
                  onClick={() => void documentsQuery.fetchNextPage()}
                >
                  {documentsQuery.isFetchingNextPage ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : null}
                  {pick("加载更多资料", "Load more materials")}
                </button>
              </div>
            )}
          </>
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
