import { Check, Copy } from "lucide-react";
import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

function nodeText(value: React.ReactNode): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(nodeText).join("");
  if (value && typeof value === "object" && "props" in value) {
    const props = value.props as { children?: React.ReactNode };
    return nodeText(props.children);
  }
  return "";
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="quiet-button min-h-8 px-2 text-xs"
      aria-label={label}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "已复制" : "复制"}
    </button>
  );
}

const markdownComponents: Components = {
  a: ({ children, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-[#3157D5] underline underline-offset-2"
    >
      {children}
    </a>
  ),
  code: ({ className, children, ...props }) => (
    <code
      {...props}
      className={
        className ??
        "rounded bg-slate-200/70 px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-slate-700"
      }
    >
      {children}
    </code>
  ),
  pre: ({ children }) => {
    const text = nodeText(children).replace(/\n$/, "");
    return (
      <div className="my-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-950 dark:border-slate-700">
        <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5 text-[11px] text-slate-400">
          <span>代码</span>
          <CopyButton text={text} label="复制代码" />
        </div>
        <pre className="overflow-x-auto p-4 text-sm leading-6 text-slate-100">
          {children}
        </pre>
      </div>
    );
  },
  h1: ({ children }) => <h3 className="mb-2 mt-5 text-lg font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-2 mt-4 text-sm font-semibold">{children}</h4>,
  p: ({ children }) => <p className="my-2 leading-7">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-4 border-indigo-300 pl-4 text-slate-600 dark:text-slate-300">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-slate-300 bg-slate-100 px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-slate-300 px-3 py-2 dark:border-slate-700">
      {children}
    </td>
  ),
};

export function TeachingResponse({ content }: { content: string }) {
  return (
    <div className="text-sm text-slate-700 dark:text-slate-200">
      <div className="mb-2 flex justify-end">
        <CopyButton text={content} label="复制完整教学回答" />
      </div>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
