import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Braces,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Focus,
  GitBranch,
  History,
  Network,
  Quote,
  ScrollText,
  Shapes,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { cognitiveLevels } from "@/components/shared/cognitiveLevels";
import {
  adaptDomainAssertionDetail,
  adaptDomainNodeDetail,
  domainNodeTypeLabel,
  epistemicStatusLabel,
  type AssertionHistoryItem,
  type DomainNodeSummary,
  type DomainRelationSummary,
  type DomainSourceSummary,
} from "@/lib/domainDetails";
import { displayPercent, formatDate, isUuid, jsonText } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export function DomainNodeDetail({
  data,
  onFocus,
}: {
  data: unknown;
  onFocus?: () => void;
}) {
  const { locale, pick } = useI18n();
  const detail = adaptDomainNodeDetail(data, locale);
  if (!detail) return <InvalidDetail kind={pick("节点", "Node")} value={data} />;
  const learningTarget = {
    ...(detail.node.id && isUuid(detail.node.id)
      ? { id: detail.node.id }
      : {}),
    name: detail.node.name,
    prompt: pick(`我想学习“${detail.node.name}”。请先确认这个学习目标，再开始讲解。`, `I want to learn “${detail.node.name}”. Please confirm this goal before teaching.`),
    source: "domain-graph",
  };
  return (
    <div className="mt-5 space-y-5">
      <section className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-[#3157D5]">
              {domainNodeTypeLabel(detail.node.type, locale)}
            </p>
            <h3 className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">
              {detail.node.name}
            </h3>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <Badge>{epistemicStatusLabel(detail.node.epistemicStatus, locale)}</Badge>
            {detail.node.confidence !== null && (
              <Badge>{pick("来源置信度", "Source confidence")} {displayPercent(detail.node.confidence)}</Badge>
            )}
          </div>
        </div>
      </section>

      <DetailSection icon={ScrollText} title={pick("定义", "Definition")}>
        <div className="grid gap-3">
          <DefinitionBlock label={pick("简明定义", "Plain-language definition")} value={detail.plainDefinition} />
          <DefinitionBlock label={pick("正式定义", "Formal definition")} value={detail.formalDefinition} />
        </div>
      </DetailSection>

      <DetailSection icon={Shapes} title={pick("所属理论或领域", "Theory or domain")}>
        <p className="text-sm text-slate-700 dark:text-slate-200">
          {detail.domain ?? pick("暂无所属领域记录", "No domain is recorded")}
        </p>
        {detail.theories.length > 0 ? (
          <NodePills nodes={detail.theories} />
        ) : (
          <Unavailable>{pick("暂无关联理论", "No related theories")}</Unavailable>
        )}
      </DetailSection>

      <div className="grid gap-4 sm:grid-cols-2">
        <DetailSection icon={GitBranch} title={pick("前置知识", "Prerequisites")}>
          {detail.prerequisites.length > 0 ? (
            <NodePills nodes={detail.prerequisites} />
          ) : (
            <Unavailable>{pick("暂无前置知识", "No prerequisites")}</Unavailable>
          )}
        </DetailSection>
        <DetailSection icon={Network} title={pick("相关知识", "Related knowledge")}>
          {detail.relatedNodes.length > 0 ? (
            <NodePills nodes={detail.relatedNodes} />
          ) : (
            <Unavailable>{pick("暂无相关知识点", "No related knowledge points")}</Unavailable>
          )}
        </DetailSection>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <DetailSection icon={ArrowDownLeft} title={pick("指向此知识点", "Relationships to this topic")}>
          <RelationList items={detail.incoming} />
        </DetailSection>
        <DetailSection icon={ArrowUpRight} title={pick("从此知识点出发", "Relationships from this topic")}>
          <RelationList items={detail.outgoing} />
        </DetailSection>
      </div>

      <DetailSection icon={BookOpen} title={pick("学习阶段", "Learning stages")}>
        {detail.learningStages.length > 0 ? (
          <div className="space-y-2">
            {detail.learningStages.map((stage, index) => {
              const level = cognitiveLevels.find(
                (item) => item.id === stage.level,
              );
              return (
                <article
                  key={stage.id ?? `${stage.level ?? "unknown"}-${index}`}
                  className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60"
                >
                  <p className="text-xs font-semibold text-[#3157D5]">
                    {level
                      ? `${level.code} · ${locale === "en" ? level.nameEn : level.name}`
                      : stage.level !== null
                        ? `L${stage.level}`
                        : pick("教学层级未提供", "Learning level unavailable")}
                  </p>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                    {stage.objective ?? pick("暂无学习目标说明", "No learning objective is available")}
                  </p>
                  {stage.strategy && (
                    <p className="mt-1 text-xs text-slate-500">
                      {pick("教学方法", "Teaching method")}：{stage.strategy}
                    </p>
                  )}
                  {stage.diagnosticQuestion && (
                    <p className="mt-1 text-xs text-slate-500">
                      {pick("掌握检测", "Mastery check")}：{stage.diagnosticQuestion}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <Unavailable>{pick("暂无教学阶段建议", "No learning-stage guidance is available")}</Unavailable>
        )}
      </DetailSection>

      <DetailSection icon={Quote} title={pick("来源", "Sources")}>
        <SourceList items={detail.sources} />
      </DetailSection>

      <div className="flex flex-wrap gap-2">
        <Link to="/learn" state={{ learningTarget }} className="primary-button">
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          {pick("开始学习", "Start learning")}
        </Link>
        {onFocus && (
          <button type="button" onClick={onFocus} className="secondary-button">
            <Focus className="h-4 w-4" aria-hidden="true" />
            {pick("加载局部子图", "Focus on this topic")}
          </button>
        )}
      </div>
      <RawDetail value={detail.raw} />
    </div>
  );
}

export function DomainAssertionDetail({ data }: { data: unknown }) {
  const { locale, pick } = useI18n();
  const detail = adaptDomainAssertionDetail(data, locale);
  if (!detail) return <InvalidDetail kind={pick("关系", "Relationship")} value={data} />;
  return (
    <div className="mt-5 space-y-5">
      <section className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#3157D5]">
          {pick("知识关系", "Knowledge relationship")}
        </p>
        <p className="mt-2 text-base font-semibold leading-7 text-slate-900 dark:text-white">
          {detail.description}
        </p>
      </section>

      <section
        className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2"
        aria-label={pick("关系方向", "Relationship direction")}
      >
        <EndpointCard label={pick("起点", "From")} node={detail.subject} />
        <div className="text-center">
          <ArrowUpRight className="mx-auto h-5 w-5 text-[#3157D5]" aria-hidden="true" />
          <p className="mt-1 max-w-24 text-[10px] font-medium text-[#3157D5]">
            {detail.relationTypeLabel}
          </p>
        </div>
        <EndpointCard label={pick("终点", "To")} node={detail.object} />
      </section>

      <DetailSection icon={CircleDot} title={pick("关系状态", "Relationship status")}>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact label={pick("关系类型", "Relationship type")} value={detail.relationTypeLabel} />
          <Fact
            label={pick("置信度", "Confidence")}
            value={
              detail.confidence === null
                ? pick("暂无记录", "Not recorded")
                : displayPercent(detail.confidence)
            }
          />
          <Fact
            label={pick("知识确认状态", "Knowledge status")}
            value={epistemicStatusLabel(detail.epistemicStatus, locale)}
          />
          <Fact
            label={pick("当前有效", "Currently active")}
            value={
              detail.isActive === null
                ? pick("暂无记录", "Not recorded")
                : detail.isActive
                  ? pick("是", "Yes")
                  : pick("否", "No")
            }
          />
        </dl>
      </DetailSection>

      <DetailSection icon={CalendarClock} title={pick("有效时间", "Validity")}>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact label={pick("开始", "Starts")} value={formatDate(detail.validFrom, true, locale)} />
          <Fact
            label={pick("结束", "Ends")}
            value={detail.validTo ? formatDate(detail.validTo, true, locale) : pick("仍然有效", "Still active")}
          />
        </dl>
      </DetailSection>

      <DetailSection icon={Quote} title={pick("来源", "Sources")}>
        <SourceList items={detail.sources} />
      </DetailSection>

      <DetailSection icon={AlertTriangle} title={pick("冲突", "Conflicts")}>
        {detail.conflicts.length > 0 ? (
          <HistoryList items={detail.conflicts} tone="warning" />
        ) : (
          <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {pick("暂无冲突记录", "No conflicts recorded")}
          </p>
        )}
      </DetailSection>

      <div className="grid gap-4 sm:grid-cols-2">
        <DetailSection icon={History} title={pick("替代的旧关系", "Relationships this replaces")}>
          {detail.supersedes.length > 0 ? (
            <HistoryList items={detail.supersedes} />
          ) : (
            <Unavailable>{pick("暂无由本关系替代的历史记录", "This relationship replaces no earlier record")}</Unavailable>
          )}
        </DetailSection>
        <DetailSection icon={History} title={pick("后续替代关系", "Newer replacement relationships")}>
          {detail.supersededBy.length > 0 ? (
            <HistoryList items={detail.supersededBy} />
          ) : (
            <Unavailable>{pick("暂无替代本关系的新版本", "No newer relationship replaces this one")}</Unavailable>
          )}
        </DetailSection>
      </div>

      <RawDetail value={detail.raw} />
    </div>
  );
}

function DetailSection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-500">
        <Icon className="h-4 w-4 text-[#3157D5]" aria-hidden="true" />
        {title}
      </h4>
      {children}
    </section>
  );
}

function DefinitionBlock({ label, value }: { label: string; value: string | null }) {
  const { pick } = useI18n();
  return (
    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
      <p className="text-[10px] font-semibold text-slate-400">{label}</p>
      <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">
        {value ?? pick("暂无记录", "Not recorded")}
      </p>
    </div>
  );
}

function NodePills({ nodes }: { nodes: DomainNodeSummary[] }) {
  const { locale } = useI18n();
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {nodes.map((node, index) => (
        <span
          key={node.id ?? `${node.name}-${index}`}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
        >
          {node.name}
          <span className="ml-1 text-[10px] text-slate-400">
            {domainNodeTypeLabel(node.type, locale)}
          </span>
        </span>
      ))}
    </div>
  );
}

function RelationList({ items }: { items: DomainRelationSummary[] }) {
  const { pick } = useI18n();
  if (!items.length) return <Unavailable>{pick("暂无关系", "No relationships")}</Unavailable>;
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <article
          key={item.id ?? `${item.predicate}-${item.endpointId}-${index}`}
          className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60"
        >
          <p className="text-sm font-medium leading-5 text-slate-700 dark:text-slate-200">
            {item.description}
          </p>
          <p className="mt-1 text-[10px] text-slate-400">
            {item.predicateLabel} · {item.endpoint?.name ?? pick("未命名知识点", "Unnamed knowledge point")}
            {item.active === false ? pick(" · 已失效", " · Inactive") : ""}
          </p>
        </article>
      ))}
    </div>
  );
}

function SourceList({ items }: { items: DomainSourceSummary[] }) {
  const { pick } = useI18n();
  if (!items.length) return <Unavailable>{pick("暂无来源", "No sources")}</Unavailable>;
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <article
          key={item.id ?? `${item.documentName}-${index}`}
          className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60"
        >
          <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
            {item.documentName ?? pick("来源文档名称未提供", "Unnamed source material")}
            {item.page !== null ? pick(` · 第 ${item.page} 页`, ` · Page ${item.page}`) : ""}
          </p>
          {item.excerpt && (
            <p className="mt-1 line-clamp-4 text-xs leading-5 text-slate-500">
              {item.excerpt}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}

function EndpointCard({ label, node }: { label: string; node: DomainNodeSummary }) {
  const { locale } = useI18n();
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 p-3 text-center dark:border-slate-700">
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
        {node.name}
      </p>
      <p className="mt-1 text-[10px] text-slate-400">
        {domainNodeTypeLabel(node.type, locale)}
      </p>
    </div>
  );
}

function HistoryList({
  items,
  tone = "neutral",
}: {
  items: AssertionHistoryItem[];
  tone?: "neutral" | "warning";
}) {
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <article
          key={item.id ?? `${item.description}-${index}`}
          className={
            tone === "warning"
              ? "rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30"
              : "rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60"
          }
        >
          <p className="text-xs leading-5 text-slate-700 dark:text-slate-200">
            {item.description}
          </p>
        </article>
      ))}
    </div>
  );
}

function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] text-slate-400">{label}</dt>
      <dd
        className={`mt-1 break-words text-sm text-slate-700 dark:text-slate-200 ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-white px-2 py-1 text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
      {children}
    </span>
  );
}

function Unavailable({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-400">{children}</p>;
}

function RawDetail({ value }: { value: unknown }) {
  const { pick } = useI18n();
  return (
    <details className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-slate-500">
        <Braces className="h-4 w-4" aria-hidden="true" />
        {pick("技术原始数据", "Raw technical data")}
      </summary>
      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-5 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
        {jsonText(value)}
      </pre>
    </details>
  );
}

function InvalidDetail({ kind, value }: { kind: string; value: unknown }) {
  const { pick } = useI18n();
  return (
    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      {pick(`${kind}详情格式异常，暂时无法生成结构化视图。`, `${kind} details could not be shown in a structured view.`)}
      <RawDetail value={value} />
    </div>
  );
}
