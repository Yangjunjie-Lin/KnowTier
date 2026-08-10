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

export function DomainNodeDetail({
  data,
  onFocus,
}: {
  data: unknown;
  onFocus?: () => void;
}) {
  const detail = adaptDomainNodeDetail(data);
  if (!detail) return <InvalidDetail kind="节点" value={data} />;
  const learningTarget = {
    ...(detail.node.id && isUuid(detail.node.id)
      ? { id: detail.node.id }
      : {}),
    name: detail.node.name,
    prompt: `我想学习“${detail.node.name}”。请先确认这个学习目标，再开始讲解。`,
    source: "domain-graph",
  };
  return (
    <div className="mt-5 space-y-5">
      <section className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-[#3157D5]">
              {domainNodeTypeLabel(detail.node.type)}
            </p>
            <h3 className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">
              {detail.node.name}
            </h3>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <Badge>{epistemicStatusLabel(detail.node.epistemicStatus)}</Badge>
            {detail.node.confidence !== null && (
              <Badge>来源置信度 {displayPercent(detail.node.confidence)}</Badge>
            )}
          </div>
        </div>
        {detail.node.id && (
          <p className="mt-3 break-all font-mono text-[10px] text-slate-400">
            {detail.node.id}
          </p>
        )}
      </section>

      <DetailSection icon={ScrollText} title="定义">
        <div className="grid gap-3">
          <DefinitionBlock label="简明定义" value={detail.plainDefinition} />
          <DefinitionBlock label="正式定义" value={detail.formalDefinition} />
        </div>
      </DetailSection>

      <DetailSection icon={Shapes} title="所属理论或领域">
        <p className="text-sm text-slate-700 dark:text-slate-200">
          {detail.domain ?? "暂无所属领域记录"}
        </p>
        {detail.theories.length > 0 ? (
          <NodePills nodes={detail.theories} />
        ) : (
          <Unavailable>暂无关联理论</Unavailable>
        )}
      </DetailSection>

      <div className="grid gap-4 sm:grid-cols-2">
        <DetailSection icon={GitBranch} title="前置知识">
          {detail.prerequisites.length > 0 ? (
            <NodePills nodes={detail.prerequisites} />
          ) : (
            <Unavailable>暂无前置知识</Unavailable>
          )}
        </DetailSection>
        <DetailSection icon={Network} title="相关节点">
          {detail.relatedNodes.length > 0 ? (
            <NodePills nodes={detail.relatedNodes} />
          ) : (
            <Unavailable>暂无相关知识点</Unavailable>
          )}
        </DetailSection>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <DetailSection icon={ArrowDownLeft} title="入向关系">
          <RelationList items={detail.incoming} />
        </DetailSection>
        <DetailSection icon={ArrowUpRight} title="出向关系">
          <RelationList items={detail.outgoing} />
        </DetailSection>
      </div>

      <DetailSection icon={BookOpen} title="教学阶段与六级内容">
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
                      ? `${level.code} · ${level.name}`
                      : stage.level !== null
                        ? `L${stage.level}`
                        : "教学层级未提供"}
                  </p>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                    {stage.objective ?? "暂无学习目标说明"}
                  </p>
                  {stage.strategy && (
                    <p className="mt-1 text-xs text-slate-500">
                      教学方法：{stage.strategy}
                    </p>
                  )}
                  {stage.diagnosticQuestion && (
                    <p className="mt-1 text-xs text-slate-500">
                      掌握检测：{stage.diagnosticQuestion}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <Unavailable>暂无教学阶段建议</Unavailable>
        )}
      </DetailSection>

      <DetailSection icon={Quote} title="来源">
        <SourceList items={detail.sources} />
      </DetailSection>

      <div className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700">
        图谱版本：
        <span className="ml-1 break-all font-mono text-slate-700 dark:text-slate-200">
          {detail.graphRevision ?? "暂无记录"}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link to="/learn" state={{ learningTarget }} className="primary-button">
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          开始学习
        </Link>
        {onFocus && (
          <button type="button" onClick={onFocus} className="secondary-button">
            <Focus className="h-4 w-4" aria-hidden="true" />
            加载局部子图
          </button>
        )}
      </div>
      <RawDetail value={detail.raw} />
    </div>
  );
}

export function DomainAssertionDetail({ data }: { data: unknown }) {
  const detail = adaptDomainAssertionDetail(data);
  if (!detail) return <InvalidDetail kind="关系" value={data} />;
  return (
    <div className="mt-5 space-y-5">
      <section className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#3157D5]">
          自然语言关系
        </p>
        <p className="mt-2 text-base font-semibold leading-7 text-slate-900 dark:text-white">
          {detail.description}
        </p>
        {detail.id && (
          <p className="mt-3 break-all font-mono text-[10px] text-slate-400">
            {detail.id}
          </p>
        )}
      </section>

      <section
        className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2"
        aria-label="关系方向"
      >
        <EndpointCard label="主体" node={detail.subject} />
        <div className="text-center">
          <ArrowUpRight className="mx-auto h-5 w-5 text-[#3157D5]" aria-hidden="true" />
          <p className="mt-1 max-w-24 text-[10px] font-medium text-[#3157D5]">
            {detail.relationTypeLabel}
          </p>
        </div>
        <EndpointCard label="客体" node={detail.object} />
      </section>

      <DetailSection icon={CircleDot} title="关系状态">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact label="关系类型" value={detail.relationType} mono />
          <Fact
            label="置信度"
            value={
              detail.confidence === null
                ? "暂无记录"
                : displayPercent(detail.confidence)
            }
          />
          <Fact
            label="认识论状态"
            value={epistemicStatusLabel(detail.epistemicStatus)}
          />
          <Fact
            label="当前有效"
            value={
              detail.isActive === null
                ? "暂无记录"
                : detail.isActive
                  ? "是"
                  : "否"
            }
          />
        </dl>
      </DetailSection>

      <DetailSection icon={CalendarClock} title="有效时间">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact label="开始" value={formatDate(detail.validFrom, true)} />
          <Fact
            label="结束"
            value={detail.validTo ? formatDate(detail.validTo, true) : "仍然有效"}
          />
        </dl>
      </DetailSection>

      <DetailSection icon={Quote} title="来源">
        <SourceList items={detail.sources} />
      </DetailSection>

      <DetailSection icon={AlertTriangle} title="冲突">
        {detail.conflicts.length > 0 ? (
          <HistoryList items={detail.conflicts} tone="warning" />
        ) : (
          <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            暂无冲突记录
          </p>
        )}
      </DetailSection>

      <div className="grid gap-4 sm:grid-cols-2">
        <DetailSection icon={History} title="Supersedes 历史">
          {detail.supersedes.length > 0 ? (
            <HistoryList items={detail.supersedes} />
          ) : (
            <Unavailable>暂无由本关系替代的历史记录</Unavailable>
          )}
        </DetailSection>
        <DetailSection icon={History} title="Superseded by 历史">
          {detail.supersededBy.length > 0 ? (
            <HistoryList items={detail.supersededBy} />
          ) : (
            <Unavailable>暂无替代本关系的新版本</Unavailable>
          )}
        </DetailSection>
      </div>

      <div className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700">
        图谱版本：
        <span className="ml-1 break-all font-mono text-slate-700 dark:text-slate-200">
          {detail.graphRevision ?? "暂无记录"}
        </span>
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
  return (
    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
      <p className="text-[10px] font-semibold text-slate-400">{label}</p>
      <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">
        {value ?? "暂无记录"}
      </p>
    </div>
  );
}

function NodePills({ nodes }: { nodes: DomainNodeSummary[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {nodes.map((node, index) => (
        <span
          key={node.id ?? `${node.name}-${index}`}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
          title={node.id ?? undefined}
        >
          {node.name}
          <span className="ml-1 text-[10px] text-slate-400">
            {domainNodeTypeLabel(node.type)}
          </span>
        </span>
      ))}
    </div>
  );
}

function RelationList({ items }: { items: DomainRelationSummary[] }) {
  if (!items.length) return <Unavailable>暂无关系</Unavailable>;
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
            {item.predicateLabel} · {item.endpoint?.name ?? item.endpointId ?? "端点未提供"}
            {item.active === false ? " · 已失效" : ""}
          </p>
        </article>
      ))}
    </div>
  );
}

function SourceList({ items }: { items: DomainSourceSummary[] }) {
  if (!items.length) return <Unavailable>暂无来源</Unavailable>;
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <article
          key={item.id ?? `${item.documentName}-${index}`}
          className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60"
        >
          <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
            {item.documentName ?? "来源文档名称未提供"}
            {item.page !== null ? ` · 第 ${item.page} 页` : ""}
          </p>
          {item.excerpt && (
            <p className="mt-1 line-clamp-4 text-xs leading-5 text-slate-500">
              {item.excerpt}
            </p>
          )}
          {item.id && (
            <p className="mt-1 break-all font-mono text-[10px] text-slate-400">
              {item.id}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}

function EndpointCard({ label, node }: { label: string; node: DomainNodeSummary }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 p-3 text-center dark:border-slate-700">
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
        {node.name}
      </p>
      <p className="mt-1 text-[10px] text-slate-400">
        {domainNodeTypeLabel(node.type)}
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
          {item.id && (
            <p className="mt-1 break-all font-mono text-[10px] text-slate-400">
              {item.id}
            </p>
          )}
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
  return (
    <details className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-slate-500">
        <Braces className="h-4 w-4" aria-hidden="true" />
        技术原始数据
      </summary>
      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-5 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
        {jsonText(value)}
      </pre>
    </details>
  );
}

function InvalidDetail({ kind, value }: { kind: string; value: unknown }) {
  return (
    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      {kind}详情格式异常，暂时无法生成结构化视图。
      <RawDetail value={value} />
    </div>
  );
}
