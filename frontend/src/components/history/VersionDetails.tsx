import {
  AlertTriangle,
  ArrowUpRight,
  BookMarked,
  Braces,
  CheckCircle2,
  CircleDot,
  FileClock,
  GitCommitHorizontal,
  History,
  Link2,
  Network,
  Quote,
  RefreshCw,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  adaptDomainVersionDetail,
  adaptLearnerVersionDetail,
  learnerDecisionLabel,
  versionStatusLabel,
  type LearnerVersionRelation,
  type VersionChangeMetric,
} from "@/lib/versionDetails";
import { displayPercent, formatDate, jsonText } from "@/lib/utils";

export function DomainVersionDetail({ data }: { data: unknown }) {
  const detail = adaptDomainVersionDetail(data);
  if (!detail) return <InvalidVersion kind="领域" value={data} />;
  return (
    <div className="mt-5 space-y-5">
      <section className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#3157D5]">领域图谱版本</p>
            <h3 className="mt-1 font-mono text-2xl font-semibold text-slate-900 dark:text-white">
              {detail.sequenceNumber === null
                ? "版本号未提供"
                : `v${detail.sequenceNumber}`}
            </h3>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5 text-[10px]">
            <StatusBadge label="状态" value={versionStatusLabel(detail.status)} />
            <StatusBadge
              label="Projection"
              value={versionStatusLabel(detail.projectionStatus)}
            />
          </div>
        </div>
        {detail.id && (
          <p className="mt-3 break-all font-mono text-[10px] text-slate-400">
            {detail.id}
          </p>
        )}
      </section>

      <VersionSection icon={FileClock} title="版本信息">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact
            label="父版本"
            value={
              detail.parentRevisionId ??
              (detail.hasParentField ? "首个版本（无父版本）" : "后端未提供")
            }
            mono={Boolean(detail.parentRevisionId)}
          />
          <Fact label="创建者" value={detail.createdBy ?? "后端未提供"} />
          <Fact
            label="模型运行"
            value={detail.modelRunId ?? "后端未提供"}
            mono={Boolean(detail.modelRunId)}
          />
          <Fact label="创建时间" value={formatDate(detail.createdAt, true)} />
          <Fact
            label="投影时间"
            value={
              detail.projectedAt
                ? formatDate(detail.projectedAt, true)
                : "后端未提供"
            }
          />
        </dl>
      </VersionSection>

      <VersionSection icon={GitCommitHorizontal} title="本版本变化">
        <div className="grid gap-3 sm:grid-cols-2">
          <ChangeCard icon={Sparkles} label="新增节点" metric={detail.nodesAdded} />
          <ChangeCard icon={Network} label="新增关系" metric={detail.relationsAdded} />
          <ChangeCard
            icon={RefreshCw}
            label="替代关系"
            metric={detail.relationsSuperseded}
          />
          <ChangeCard icon={AlertTriangle} label="冲突" metric={detail.conflicts} />
          <ChangeCard icon={Quote} label="来源变化" metric={detail.sourceChanges} />
          <ChangeCard icon={ArrowUpRight} label="更新节点" metric={detail.nodesUpdated} />
        </div>
      </VersionSection>

      <VersionSection icon={BookMarked} title="摘要">
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">
          {detail.summaryNarrative}
        </p>
      </VersionSection>

      {detail.manifestFacts.length > 0 && (
        <VersionSection icon={Network} title="版本 Manifest">
          <dl className="grid gap-3 sm:grid-cols-2">
            {detail.manifestFacts.map((fact) => (
              <Fact key={fact.label} label={fact.label} value={fact.value} />
            ))}
          </dl>
        </VersionSection>
      )}
      <RawVersion value={detail.raw} />
    </div>
  );
}

export function LearnerVersionDetail({ data }: { data: unknown }) {
  const detail = adaptLearnerVersionDetail(data);
  if (!detail) return <InvalidVersion kind="学生" value={data} />;
  return (
    <div className="mt-5 space-y-5">
      <section className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
        <p className="text-xs font-medium text-[#3157D5]">学生图谱版本</p>
        <h3 className="mt-1 font-mono text-2xl font-semibold text-slate-900 dark:text-white">
          {detail.sequenceNumber === null
            ? "版本号未提供"
            : `v${detail.sequenceNumber}`}
        </h3>
        {detail.id && (
          <p className="mt-3 break-all font-mono text-[10px] text-slate-400">
            {detail.id}
          </p>
        )}
      </section>

      <VersionSection icon={UserRound} title="学习上下文">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact label="Session" value={detail.sessionId ?? "后端未提供"} mono />
          <Fact label="Turn" value={detail.turnId ?? "后端未提供"} mono />
          <Fact
            label="目标知识点"
            value={detail.targetKnowledgePointId ?? "后端未提供"}
            mono
          />
          <Fact label="时间" value={formatDate(detail.createdAt, true)} />
          <Fact
            label="父版本"
            value={detail.parentRevisionId ?? "无父版本或后端未提供"}
            mono={Boolean(detail.parentRevisionId)}
          />
        </dl>
      </VersionSection>

      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryCard
          icon={Link2}
          label="新增学生关系"
          value={countText(detail.assertionsAddedCount)}
        />
        <SummaryCard
          icon={RefreshCw}
          label="被替代关系"
          value={countText(detail.assertionsSupersededCount)}
        />
      </div>

      <VersionSection icon={Link2} title="新增学生关系">
        {detail.addedRelations.length > 0 ? (
          <div className="space-y-2">
            {detail.addedRelations.map((relation, index) => (
              <LearnerRelationCard
                key={relation.id ?? `${relation.predicate}-${index}`}
                relation={relation}
              />
            ))}
          </div>
        ) : (
          <Unavailable>后端未提供新增关系条目</Unavailable>
        )}
      </VersionSection>

      <VersionSection icon={RefreshCw} title="被替代关系">
        {detail.supersededRelationIds.length > 0 ? (
          <div className="space-y-2">
            {detail.supersededRelationIds.map((id) => (
              <code
                key={id}
                className="block break-all rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
              >
                {id}
              </code>
            ))}
          </div>
        ) : detail.assertionsSupersededCount !== null &&
          detail.assertionsSupersededCount > 0 ? (
          <Unavailable>
            后端只提供了替代数量，未提供被替代关系 ID。
          </Unavailable>
        ) : (
          <Unavailable>后端未返回被替代关系条目</Unavailable>
        )}
      </VersionSection>

      <VersionSection icon={CircleDot} title="掌握度变化">
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">
          {detail.masterySummary}
        </p>
        {(detail.masteryScore !== null || detail.currentLevel !== null) && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {detail.masteryScore !== null && (
              <StatusBadge
                label="本轮掌握度"
                value={displayPercent(detail.masteryScore)}
              />
            )}
            {detail.currentLevel !== null && (
              <StatusBadge label="认知层级" value={`L${detail.currentLevel}`} />
            )}
          </div>
        )}
      </VersionSection>

      <div className="grid gap-4 sm:grid-cols-2">
        <VersionSection icon={AlertTriangle} title="误解变化">
          <TextChanges
            values={detail.misconceptionChanges}
            unavailable="本版本没有可从断言中归类的误解变化；后端未提供独立误解差异。"
          />
        </VersionSection>
        <VersionSection icon={CheckCircle2} title="证据变化">
          <TextChanges
            values={detail.evidenceChanges}
            unavailable="本版本没有可从断言中归类的证据变化；后端未提供独立证据差异。"
          />
        </VersionSection>
      </div>

      <VersionSection icon={Sparkles} title="推荐动作变化">
        {detail.recommendation ? (
          <div>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
              本轮决策：
              {detail.recommendationLabel ??
                learnerDecisionLabel(detail.recommendation)}
            </p>
            <p className="mt-1 font-mono text-[10px] text-slate-400">
              {detail.recommendation}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              后端未提供上一版本的推荐动作，无法计算前后差异。
            </p>
          </div>
        ) : (
          <Unavailable>后端未提供本轮推荐动作</Unavailable>
        )}
      </VersionSection>

      <VersionSection icon={History} title="事件列表">
        {detail.events.length > 0 ? (
          <div className="space-y-2">
            {detail.events.map((event, index) => (
              <article
                key={event.id ?? `${event.eventType}-${index}`}
                className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-xs font-medium text-slate-700 dark:text-slate-200">
                    {event.eventType}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {formatDate(event.createdAt, true)}
                  </p>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  新增关系 {event.assertionsAdded ?? "后端未提供"} · 替代关系{" "}
                  {event.assertionsSuperseded ?? "后端未提供"}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <Unavailable>后端未提供事件记录</Unavailable>
        )}
      </VersionSection>
      <RawVersion value={detail.raw} />
    </div>
  );
}

function VersionSection({
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

function ChangeCard({
  icon: Icon,
  label,
  metric,
}: {
  icon: LucideIcon;
  label: string;
  metric: VersionChangeMetric;
}) {
  return (
    <article className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-[#3157D5]" aria-hidden="true" />
        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
          {label}
        </p>
        <span className="ml-auto font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">
          {!metric.provided
            ? "后端未提供"
            : metric.count === null
              ? "数量未知"
              : metric.count}
        </span>
      </div>
      {metric.items.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-slate-500">
          {metric.items.map((item, index) => (
            <li key={`${item}-${index}`}>· {item}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <article className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Icon className="h-4 w-4 text-[#3157D5]" aria-hidden="true" />
        {label}
      </div>
      <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white">
        {value}
      </p>
    </article>
  );
}

function LearnerRelationCard({ relation }: { relation: LearnerVersionRelation }) {
  return (
    <article className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-indigo-50 px-2 py-1 text-[10px] text-[#3157D5] dark:bg-indigo-950">
          {relation.predicateLabel}
        </span>
        {relation.confidence !== null && (
          <span className="text-[10px] text-slate-400">
            置信度 {displayPercent(relation.confidence)}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">
        {relation.description}
      </p>
      {(relation.subjectId || relation.objectId) && (
        <p className="mt-1 break-all font-mono text-[10px] text-slate-400">
          {relation.subjectId ?? "主体未提供"} → {relation.objectId ?? "客体未提供"}
        </p>
      )}
    </article>
  );
}

function TextChanges({
  values,
  unavailable,
}: {
  values: string[];
  unavailable: string;
}) {
  return values.length > 0 ? (
    <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
      {values.map((value, index) => (
        <li key={`${value}-${index}`}>· {value}</li>
      ))}
    </ul>
  ) : (
    <Unavailable>{unavailable}</Unavailable>
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
        className={`mt-1 break-all text-sm text-slate-700 dark:text-slate-200 ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function StatusBadge({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md bg-white px-2 py-1 text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
      {label} · {value}
    </span>
  );
}

function Unavailable({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-5 text-slate-400">{children}</p>;
}

function countText(value: number | null): string {
  return value === null ? "后端未提供" : String(value);
}

function RawVersion({ value }: { value: unknown }) {
  return (
    <details className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-slate-500">
        <Braces className="h-4 w-4" aria-hidden="true" />
        原始数据（调试）
      </summary>
      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-5 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
        {jsonText(value)}
      </pre>
    </details>
  );
}

function InvalidVersion({ kind, value }: { kind: string; value: unknown }) {
  return (
    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      后端返回的{kind}版本详情不是对象，无法生成类型化视图。
      <RawVersion value={value} />
    </div>
  );
}
