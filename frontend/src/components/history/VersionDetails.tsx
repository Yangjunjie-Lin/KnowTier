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
import { useI18n } from "@/lib/i18n";

export function DomainVersionDetail({ data }: { data: unknown }) {
  const { locale, pick } = useI18n();
  const detail = adaptDomainVersionDetail(data, locale);
  if (!detail) return <InvalidVersion kind={pick("领域", "Domain")} value={data} />;
  return (
    <div className="mt-5 space-y-5">
      <section className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#3157D5]">{pick("领域图谱版本", "Domain map version")}</p>
            <h3 className="mt-1 font-mono text-2xl font-semibold text-slate-900 dark:text-white">
              {detail.sequenceNumber === null
                ? pick("版本号未提供", "Version number unavailable")
                : `v${detail.sequenceNumber}`}
            </h3>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5 text-[10px]">
            <StatusBadge label={pick("状态", "Status")} value={versionStatusLabel(detail.status, locale)} />
            <StatusBadge
              label={pick("图谱投影", "Graph projection")}
              value={versionStatusLabel(detail.projectionStatus, locale)}
            />
          </div>
        </div>
      </section>

      <VersionSection icon={FileClock} title={pick("版本信息", "Version information")}>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact
            label={pick("父版本", "Parent version")}
            value={
              detail.parentRevisionId
                ? pick("基于上一个版本", "Based on the previous version")
                :
              (detail.hasParentField ? pick("首个版本（无父版本）", "First version (no parent)") : pick("暂无记录", "Not recorded"))
            }
          />
          <Fact label={pick("创建方式", "Created by")} value={createdByLabel(detail.createdBy, locale)} />
          <Fact
            label={pick("模型运行", "Model run")}
            value={detail.modelRunId ? pick("已记录", "Recorded") : pick("暂无记录", "Not recorded")}
          />
          <Fact label={pick("创建时间", "Created")} value={formatDate(detail.createdAt, true, locale)} />
          <Fact
            label={pick("投影时间", "Projected")}
            value={
              detail.projectedAt
                ? formatDate(detail.projectedAt, true, locale)
                : pick("尚未完成", "Not completed")
            }
          />
        </dl>
        <TechnicalIdentifiers
          values={[
            [pick("版本 ID", "Version ID"), detail.id],
            [pick("父版本 ID", "Parent version ID"), detail.parentRevisionId],
            [pick("模型运行 ID", "Model run ID"), detail.modelRunId],
            [pick("原始创建者", "Raw creator"), detail.createdBy],
          ]}
        />
      </VersionSection>

      <VersionSection icon={GitCommitHorizontal} title={pick("本版本变化", "Changes in this version")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChangeCard icon={Sparkles} label={pick("新增节点", "Nodes added")} metric={detail.nodesAdded} />
          <ChangeCard icon={Network} label={pick("新增关系", "Relationships added")} metric={detail.relationsAdded} />
          <ChangeCard
            icon={RefreshCw}
            label={pick("替代关系", "Relationships replaced")}
            metric={detail.relationsSuperseded}
          />
          <ChangeCard icon={AlertTriangle} label={pick("冲突", "Conflicts")} metric={detail.conflicts} />
          <ChangeCard icon={Quote} label={pick("来源变化", "Source changes")} metric={detail.sourceChanges} />
          <ChangeCard icon={ArrowUpRight} label={pick("更新节点", "Nodes updated")} metric={detail.nodesUpdated} />
        </div>
      </VersionSection>

      <VersionSection icon={BookMarked} title={pick("摘要", "Summary")}>
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">
          {detail.summaryNarrative}
        </p>
      </VersionSection>

      {detail.manifestFacts.length > 0 && (
        <VersionSection icon={Network} title={pick("版本数据概览", "Version data overview")}>
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
  const { locale, pick } = useI18n();
  const detail = adaptLearnerVersionDetail(data, locale);
  if (!detail) return <InvalidVersion kind={pick("学生", "Learner")} value={data} />;
  return (
    <div className="mt-5 space-y-5">
      <section className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
        <p className="text-xs font-medium text-[#3157D5]">{pick("学生图谱版本", "Learner map version")}</p>
        <h3 className="mt-1 font-mono text-2xl font-semibold text-slate-900 dark:text-white">
          {detail.sequenceNumber === null
            ? pick("版本号未提供", "Version number unavailable")
            : `v${detail.sequenceNumber}`}
        </h3>
      </section>

      <VersionSection icon={UserRound} title={pick("学习上下文", "Learning context")}>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact label={pick("学习会话", "Learning session")} value={detail.sessionId ? pick("已关联", "Linked") : pick("暂无记录", "Not recorded")} />
          <Fact label={pick("学习轮次", "Learning turn")} value={detail.turnId ? pick("已记录", "Recorded") : pick("暂无记录", "Not recorded")} />
          <Fact
            label={pick("目标知识点", "Target knowledge point")}
            value={detail.targetKnowledgePointId ? pick("已关联", "Linked") : pick("暂无记录", "Not recorded")}
          />
          <Fact label={pick("时间", "Time")} value={formatDate(detail.createdAt, true, locale)} />
          <Fact
            label={pick("父版本", "Parent version")}
            value={detail.parentRevisionId ? pick("基于上一个版本", "Based on the previous version") : pick("首个版本或暂无记录", "First version or not recorded")}
          />
        </dl>
        <TechnicalIdentifiers
          values={[
            [pick("版本 ID", "Version ID"), detail.id],
            [pick("父版本 ID", "Parent version ID"), detail.parentRevisionId],
            [pick("会话 ID", "Session ID"), detail.sessionId],
            [pick("轮次 ID", "Turn ID"), detail.turnId],
            [pick("目标知识点 ID", "Target knowledge point ID"), detail.targetKnowledgePointId],
          ]}
        />
      </VersionSection>

      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryCard
          icon={Link2}
          label={pick("新增学生关系", "Learner relationships added")}
          value={countText(detail.assertionsAddedCount, locale)}
        />
        <SummaryCard
          icon={RefreshCw}
          label={pick("被替代关系", "Relationships replaced")}
          value={countText(detail.assertionsSupersededCount, locale)}
        />
      </div>

      <VersionSection icon={Link2} title={pick("新增学生关系", "Learner relationships added")}>
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
          <Unavailable>{pick("此版本没有可展示的新增关系明细。", "This version has no relationship additions to show.")}</Unavailable>
        )}
      </VersionSection>

      <VersionSection icon={RefreshCw} title={pick("被替代关系", "Replaced relationships")}>
        {detail.supersededRelationIds.length > 0 ? (
          <div>
            <p className="text-sm text-slate-700 dark:text-slate-200">
              {pick(`已替代 ${detail.supersededRelationIds.length} 条旧关系。`, `${detail.supersededRelationIds.length} earlier relationships were replaced.`)}
            </p>
            <TechnicalIdentifiers
              label={pick("查看被替代关系标识", "View replaced relationship identifiers")}
              values={detail.supersededRelationIds.map((id, index) => [
                pick(`关系 ${index + 1}`, `Relationship ${index + 1}`),
                id,
              ] as [string, string])}
            />
          </div>
        ) : detail.assertionsSupersededCount !== null &&
          detail.assertionsSupersededCount > 0 ? (
          <Unavailable>
            {pick("已记录替代数量，但没有可展示的关系明细。", "A replacement count was recorded, but no details are available.")}
          </Unavailable>
        ) : (
          <Unavailable>{pick("此版本没有被替代的关系。", "This version replaced no relationships.")}</Unavailable>
        )}
      </VersionSection>

      <VersionSection icon={CircleDot} title={pick("掌握度变化", "Mastery changes")}>
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">
          {detail.masterySummary}
        </p>
        {(detail.masteryScore !== null || detail.currentLevel !== null) && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {detail.masteryScore !== null && (
              <StatusBadge
                label={pick("本轮掌握度", "Mastery")}
                value={displayPercent(detail.masteryScore)}
              />
            )}
            {detail.currentLevel !== null && (
              <StatusBadge label={pick("认知层级", "Cognitive level")} value={`L${detail.currentLevel}`} />
            )}
          </div>
        )}
      </VersionSection>

      <div className="grid gap-4 sm:grid-cols-2">
        <VersionSection icon={AlertTriangle} title={pick("误解变化", "Misconception changes")}>
          <TextChanges
            values={detail.misconceptionChanges}
            unavailable={pick("本版本没有可展示的误解变化。", "This version has no misconception changes to show.")}
          />
        </VersionSection>
        <VersionSection icon={CheckCircle2} title={pick("证据变化", "Evidence changes")}>
          <TextChanges
            values={detail.evidenceChanges}
            unavailable={pick("本版本没有可展示的证据变化。", "This version has no evidence changes to show.")}
          />
        </VersionSection>
      </div>

      <VersionSection icon={Sparkles} title={pick("推荐动作变化", "Recommendation changes")}>
        {detail.recommendation ? (
          <div>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
              {pick("本轮决策：", "This turn: ")}
              {detail.recommendationLabel ??
                learnerDecisionLabel(detail.recommendation, locale)}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {pick("目前没有上一版本的推荐动作可供比较。", "No previous recommendation is available for comparison.")}
            </p>
          </div>
        ) : (
          <Unavailable>{pick("本轮没有新增推荐动作。", "This turn added no recommendation.")}</Unavailable>
        )}
      </VersionSection>

      <VersionSection icon={History} title={pick("事件列表", "Activity log")}>
        {detail.events.length > 0 ? (
          <div className="space-y-2">
            {detail.events.map((event, index) => (
              <article
                key={event.id ?? `${event.eventType}-${index}`}
                className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                    {pick("学习状态更新", "Learning status updated")}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {formatDate(event.createdAt, true, locale)}
                  </p>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {pick("新增关系", "Added")} {event.assertionsAdded ?? pick("暂无记录", "Not recorded")} · {pick("替代关系", "Replaced")} {event.assertionsSuperseded ?? pick("暂无记录", "Not recorded")}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <Unavailable>{pick("此版本没有独立事件记录。", "This version has no separate activity records.")}</Unavailable>
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
  const { pick } = useI18n();
  return (
    <article className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-[#3157D5]" aria-hidden="true" />
        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
          {label}
        </p>
        <span className="ml-auto font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">
          {!metric.provided
            ? pick("暂无数据", "No data")
            : metric.count === null
              ? pick("数量未知", "Count unavailable")
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
  const { pick } = useI18n();
  return (
    <article className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-indigo-50 px-2 py-1 text-[10px] text-[#3157D5] dark:bg-indigo-950">
          {relation.predicateLabel}
        </span>
        {relation.confidence !== null && (
          <span className="text-[10px] text-slate-400">
            {pick("置信度", "Confidence")} {displayPercent(relation.confidence)}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">
        {relation.description}
      </p>
      {(relation.subjectId || relation.objectId) && (
        <TechnicalIdentifiers
          label={pick("查看关系标识", "View relationship identifiers")}
          values={[
            [pick("主体 ID", "Subject ID"), relation.subjectId],
            [pick("客体 ID", "Object ID"), relation.objectId],
          ]}
        />
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

function TechnicalIdentifiers({
  values,
  label,
}: {
  values: Array<readonly [string, string | null]>;
  label?: string;
}) {
  const { pick } = useI18n();
  const available = values.filter(
    (entry): entry is readonly [string, string] => Boolean(entry[1]),
  );
  if (available.length === 0) return null;
  return (
    <details className="mt-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
      <summary className="cursor-pointer text-[11px] font-medium text-slate-500">
        {label ?? pick("查看技术标识", "View technical identifiers")}
      </summary>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
        {available.map(([itemLabel, value]) => (
          <Fact key={itemLabel} label={itemLabel} value={value} mono />
        ))}
      </dl>
    </details>
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

function countText(value: number | null, locale: "zh-CN" | "en"): string {
  return value === null ? (locale === "en" ? "Not recorded" : "暂无记录") : String(value);
}

function createdByLabel(value: string | null, locale: "zh-CN" | "en"): string {
  const en = locale === "en";
  if (!value) return en ? "Not recorded" : "暂无记录";
  if (value === "system") return en ? "Created automatically" : "系统自动创建";
  if (value === "ingestion") return en ? "Created by material processing" : "资料摄取创建";
  if (value === "chat") return en ? "Created by a learning conversation" : "学习对话创建";
  return en ? "Creation source recorded" : "已记录创建来源";
}

function RawVersion({ value }: { value: unknown }) {
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

function InvalidVersion({ kind, value }: { kind: string; value: unknown }) {
  const { pick } = useI18n();
  return (
    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      {pick(`${kind}版本详情格式异常，暂时无法生成结构化视图。`, `${kind} version details could not be shown in a structured view.`)}
      <RawVersion value={value} />
    </div>
  );
}
