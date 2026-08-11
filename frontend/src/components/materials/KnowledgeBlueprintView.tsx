import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Braces,
  CheckCircle2,
  CircleHelp,
  FlaskConical,
  GitBranch,
  GraduationCap,
  Lightbulb,
  Link2,
  Quote,
  ScrollText,
  ShieldAlert,
  Waypoints,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cognitiveLevels } from "@/components/shared/cognitiveLevels";
import {
  adaptKnowledgeBlueprint,
  type BlueprintAssessment,
  type BlueprintExample,
  type BlueprintKnowledgePoint,
  type BlueprintMisconception,
} from "@/lib/knowledgeBlueprint";
import { displayPercent, jsonText } from "@/lib/utils";
import { relationLabel, useI18n } from "@/lib/i18n";

export function KnowledgeBlueprintView({ value }: { value: unknown }) {
  const { locale, pick } = useI18n();
  const blueprint = adaptKnowledgeBlueprint(value, locale);
  if (!blueprint) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        {pick("知识蓝图数据格式异常，当前无法生成结构化视图。", "The knowledge blueprint could not be displayed in a structured view.")}
        <RawData value={value} />
      </div>
    );
  }
  const assigned = new Set(
    blueprint.knowledgePoints.map((point) => point.candidateKey),
  );
  const unassignedExamples = blueprint.examples.filter(
    (item) =>
      !item.knowledgePointCandidateId ||
      !assigned.has(item.knowledgePointCandidateId),
  );
  const unassignedCounterexamples = blueprint.counterexamples.filter(
    (item) =>
      !item.knowledgePointCandidateId ||
      !assigned.has(item.knowledgePointCandidateId),
  );
  const unassignedMisconceptions = blueprint.misconceptions.filter(
    (item) =>
      !item.knowledgePointCandidateId ||
      !assigned.has(item.knowledgePointCandidateId),
  );
  const unassignedAssessments = blueprint.assessments.filter(
    (item) =>
      !item.knowledgePointCandidateId ||
      !assigned.has(item.knowledgePointCandidateId),
  );

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[#3157D5]">
              <Braces className="h-5 w-5" aria-hidden="true" />
              <span className="text-xs font-semibold uppercase tracking-[0.14em]">
                {pick("知识蓝图", "Knowledge blueprint")}
              </span>
            </div>
            <h2 className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">
              {blueprint.title}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {blueprint.domain
                ? pick(`领域：${blueprint.domain}`, `Domain: ${blueprint.domain}`)
                : pick("尚未标注所属领域", "No domain is assigned yet")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <CountBadge label={pick("理论", "Theories")} value={blueprint.theories.length} />
            <CountBadge label={pick("知识点", "Knowledge points")} value={blueprint.knowledgePoints.length} />
            <CountBadge label={pick("关系", "Relationships")} value={blueprint.relations.length} />
            <CountBadge label={pick("歧义", "Ambiguities")} value={blueprint.ambiguities.length} />
          </div>
        </div>
      </section>

      {blueprint.theories.length > 0 && (
        <ContentSection icon={ScrollText} title={pick("理论", "Theories")}>
          <div className="grid gap-3 md:grid-cols-2">
            {blueprint.theories.map((theory) => (
              <article
                key={theory.candidateKey}
                className="rounded-lg border border-slate-200 p-4 dark:border-slate-700"
              >
                <div className="flex items-start justify-between gap-3">
                  <h4 className="font-medium text-slate-900 dark:text-white">
                    {theory.name}
                  </h4>
                  {theory.confidence !== null && (
                    <span className="rounded bg-indigo-50 px-2 py-1 text-[10px] text-[#3157D5] dark:bg-indigo-950">
                      {pick("置信度", "Confidence")} {displayPercent(theory.confidence)}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {theory.description ?? pick("暂无理论说明", "No theory description is available")}
                </p>
                <SourceIds ids={theory.sourceSpanIds} />
              </article>
            ))}
          </div>
        </ContentSection>
      )}

      <ContentSection icon={GraduationCap} title={pick("知识点", "Knowledge points")}>
        {blueprint.knowledgePoints.length > 0 ? (
          <div className="space-y-4">
            {blueprint.knowledgePoints.map((point) => (
              <KnowledgePointCard key={point.candidateKey} point={point} />
            ))}
          </div>
        ) : (
          <Unavailable text={pick("知识蓝图中没有知识点记录", "The blueprint contains no knowledge points")} />
        )}
      </ContentSection>

      {blueprint.relations.length > 0 && (
        <ContentSection icon={Waypoints} title={pick("知识关系", "Knowledge relationships")}>
          <div className="space-y-2">
            {blueprint.relations.map((relation, index) => (
              <article
                key={`${relation.subjectCandidateId}-${relation.predicate}-${relation.objectCandidateId}-${index}`}
                className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
              >
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {relation.description}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {relationLabel(relation.predicate, locale)}
                  {relation.confidence !== null
                    ? ` · ${pick("置信度", "Confidence")} ${displayPercent(relation.confidence)}`
                    : ""}
                </p>
              </article>
            ))}
          </div>
        </ContentSection>
      )}

      {(unassignedExamples.length > 0 ||
        unassignedCounterexamples.length > 0 ||
        unassignedMisconceptions.length > 0 ||
        unassignedAssessments.length > 0) && (
        <ContentSection icon={CircleHelp} title={pick("待关联内容", "Content awaiting association")}>
          <p className="mb-3 text-xs text-slate-500">
            {pick("以下内容尚未关联到已知知识点，可能是关联信息缺失或对应知识点尚未生成。", "This content is not yet linked to a known knowledge point.")}
          </p>
          <SupplementaryContent
            examples={unassignedExamples}
            counterexamples={unassignedCounterexamples}
            misconceptions={unassignedMisconceptions}
            assessments={unassignedAssessments}
          />
        </ContentSection>
      )}

      <ContentSection icon={Quote} title={pick("来源", "Sources")}>
        {blueprint.sourceSpanIds.length > 0 ? (
          <details className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
            <summary className="cursor-pointer text-xs font-medium text-slate-500">
              {pick(`${blueprint.sourceSpanIds.length} 个可追溯来源`, `${blueprint.sourceSpanIds.length} traceable sources`)}
            </summary>
            <div className="mt-2 flex flex-wrap gap-2">
              {blueprint.sourceSpanIds.map((id) => <code key={id} className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{id}</code>)}
            </div>
          </details>
        ) : (
          <Unavailable text={pick("暂无可追溯来源", "No traceable sources are available")} />
        )}
      </ContentSection>

      <ContentSection icon={AlertTriangle} title={pick("冲突或未解决歧义", "Conflicts and unresolved ambiguities")}>
        {blueprint.ambiguities.length > 0 ? (
          <div className="space-y-2">
            {blueprint.ambiguities.map((item, index) => (
              <article
                key={`${item.description}-${index}`}
                className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30"
              >
                <p className="text-sm text-amber-900 dark:text-amber-100">
                  {item.description}
                </p>
                {item.candidateKeys.length > 0 && (
                  <details className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    <summary className="cursor-pointer">{pick("查看相关候选标识", "View related candidate identifiers")}</summary>
                    <p className="mt-1 break-all font-mono text-[10px]">{item.candidateKeys.join(" · ")}</p>
                  </details>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {pick("暂无未解决歧义", "No unresolved ambiguities")}
          </p>
        )}
      </ContentSection>

      <RawData value={blueprint.raw} />
    </div>
  );
}

function KnowledgePointCard({ point }: { point: BlueprintKnowledgePoint }) {
  const { locale, pick } = useI18n();
  const learningTarget = {
    ...(point.graphNodeId ? { id: point.graphNodeId } : {}),
    name: point.name,
    prompt: `我想学习“${point.name}”。请先确认这个学习目标，再开始讲解。`,
    source: "knowledge-blueprint",
  };
  return (
    <article className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            {point.name}
          </h3>
          <details className="mt-1">
            <summary className="cursor-pointer text-[10px] text-slate-400">
              {pick("查看候选标识", "View candidate identifier")}
            </summary>
            <code className="mt-1 block break-all text-[10px] text-slate-400">
              {point.candidateKey}
            </code>
          </details>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          {point.importance !== null && (
            <span className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">
              {pick("重要度", "Importance")} {displayPercent(point.importance)}
            </span>
          )}
          {point.difficulty !== null && (
            <span className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">
              {pick("难度", "Difficulty")} {displayPercent(point.difficulty)}
            </span>
          )}
          {point.confidence !== null && (
            <span className="rounded bg-indigo-50 px-2 py-1 text-[#3157D5] dark:bg-indigo-950">
              {pick("置信度", "Confidence")} {displayPercent(point.confidence)}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <LabeledBlock label={pick("简明定义", "Plain-language definition")} value={point.plainDefinition} />
        <LabeledBlock label={pick("正式定义", "Formal definition")} value={point.formalDefinition} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <Subheading icon={GitBranch}>{pick("前置知识", "Prerequisites")}</Subheading>
          {point.prerequisites.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {point.prerequisites.map((item) => (
                <span
                  key={item.key}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
                >
                  {item.name}
                </span>
              ))}
            </div>
          ) : (
            <Unavailable text={pick("暂无前置知识", "No prerequisites are listed")} compact />
          )}
        </div>
        <div>
          <Subheading icon={FlaskConical}>{pick("方法", "Methods")}</Subheading>
          {point.methods.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
              {point.methods.map((method) => (
                <li key={method}>· {method}</li>
              ))}
            </ul>
          ) : (
            <Unavailable text={pick("暂无教学方法建议", "No teaching method is available")} compact />
          )}
        </div>
      </div>

      {(point.mustCover.length > 0 || point.commonConfusions.length > 0) && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <TagGroup title={pick("必须覆盖", "Must cover")} values={point.mustCover} />
          <TagGroup title={pick("常见混淆", "Common confusions")} values={point.commonConfusions} />
        </div>
      )}

      <SupplementaryContent
        examples={point.examples}
        counterexamples={point.counterexamples}
        misconceptions={point.misconceptions}
        assessments={point.assessments}
      />

      {point.stages.length > 0 && (
        <details className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-200">
            {pick(`六级教学内容（${point.stages.length}）`, `Learning stages (${point.stages.length})`)}
          </summary>
          <div className="mt-3 space-y-2">
            {point.stages.map((stage, index) => {
              const level = cognitiveLevels.find(
                (item) => item.id === stage.cognitiveLevel,
              );
              return (
                <article
                  key={`${stage.cognitiveLevel ?? "unknown"}-${index}`}
                  className="rounded-md bg-slate-50 p-3 dark:bg-slate-800/60"
                >
                  <p className="text-xs font-semibold text-[#3157D5]">
                    {level
                      ? `${level.code} · ${locale === "en" ? level.nameEn : level.name}`
                      : stage.cognitiveLevel !== null
                        ? `L${stage.cognitiveLevel}`
                        : pick("层级未提供", "Level unavailable")}
                  </p>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                    {stage.learningObjective ?? pick("暂无学习目标", "No learning objective is available")}
                  </p>
                  {stage.diagnosticQuestion && (
                    <p className="mt-2 text-xs text-slate-500">
                      {pick("掌握检测", "Mastery check")}：{stage.diagnosticQuestion}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </details>
      )}

      <SourceIds ids={point.sourceSpanIds} />
      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
        <Link
          to="/learn"
          state={{ learningTarget }}
          className="primary-button"
        >
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          {pick("开始学习", "Start learning")}
        </Link>
        {point.graphNodeId ? (
          <Link
            to={`/graph/domain?node=${encodeURIComponent(point.graphNodeId)}`}
            className="secondary-button"
          >
            <Link2 className="h-4 w-4" aria-hidden="true" />
            {pick("在图谱中查看", "View in graph")}
          </Link>
        ) : (
          <span className="inline-flex flex-col items-start gap-1">
            <button
              type="button"
              disabled
              className="secondary-button"
              title={point.graphLinkReason ?? undefined}
            >
              <Link2 className="h-4 w-4" aria-hidden="true" />
              {pick("在图谱中查看", "View in graph")}
            </button>
            <span className="max-w-xs text-[10px] text-slate-400">
              {point.graphLinkReason}
            </span>
          </span>
        )}
      </div>
    </article>
  );
}

function SupplementaryContent({
  examples,
  counterexamples,
  misconceptions,
  assessments,
}: {
  examples: BlueprintExample[];
  counterexamples: BlueprintExample[];
  misconceptions: BlueprintMisconception[];
  assessments: BlueprintAssessment[];
}) {
  const { pick } = useI18n();
  if (
    examples.length === 0 &&
    counterexamples.length === 0 &&
    misconceptions.length === 0 &&
    assessments.length === 0
  )
    return null;
  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      {examples.length > 0 && (
        <MiniSection icon={Lightbulb} title={pick("示例", "Examples")}>
          {examples.map((item) => (
            <p key={item.candidateKey}>{item.content}</p>
          ))}
        </MiniSection>
      )}
      {counterexamples.length > 0 && (
        <MiniSection icon={ShieldAlert} title={pick("反例", "Counterexamples")}>
          {counterexamples.map((item) => (
            <div key={item.candidateKey}>
              <p>{item.content}</p>
              {item.boundaryExplained && (
                <p className="mt-1 text-xs text-slate-500">
                  {pick("边界", "Boundary")}：{item.boundaryExplained}
                </p>
              )}
            </div>
          ))}
        </MiniSection>
      )}
      {misconceptions.length > 0 && (
        <MiniSection icon={AlertTriangle} title={pick("误解", "Misconceptions")}>
          {misconceptions.map((item) => (
            <div key={item.candidateKey}>
              <p>{item.statement}</p>
              {item.correction && (
                <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                  {pick("纠正", "Correction")}：{item.correction}
                </p>
              )}
            </div>
          ))}
        </MiniSection>
      )}
      {assessments.length > 0 && (
        <MiniSection icon={CircleHelp} title={pick("掌握检测", "Mastery checks")}>
          {assessments.map((item) => (
            <div key={item.candidateKey}>
              <p>{item.question}</p>
              {item.successCriteria.length > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  {pick("通过标准", "Success criteria")}：{item.successCriteria.join(pick("；", "; "))}
                </p>
              )}
            </div>
          ))}
        </MiniSection>
      )}
    </div>
  );
}

function ContentSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ScrollText;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
        <Icon className="h-4 w-4 text-[#3157D5]" aria-hidden="true" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function MiniSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Lightbulb;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
        <Icon className="h-3.5 w-3.5 text-[#3157D5]" aria-hidden="true" />
        {title}
      </h4>
      <div className="mt-2 space-y-2 text-sm leading-6 text-slate-700 dark:text-slate-200">
        {children}
      </div>
    </section>
  );
}

function Subheading({
  icon: Icon,
  children,
}: {
  icon: typeof GitBranch;
  children: React.ReactNode;
}) {
  return (
    <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </h4>
  );
}

function LabeledBlock({ label, value }: { label: string; value: string | null }) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">
        {value ?? t("common.none")}
      </p>
    </div>
  );
}

function TagGroup({ title, values }: { title: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500">{title}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {values.map((value) => (
          <span
            key={value}
            className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

function SourceIds({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <SourceIdentifierDetails ids={ids} />
  );
}

function SourceIdentifierDetails({ ids }: { ids: string[] }) {
  const { pick } = useI18n();
  return (
    <details className="mt-3 text-[10px] text-slate-400">
      <summary className="flex cursor-pointer list-none items-center gap-1.5">
        <Quote className="h-3 w-3 shrink-0" aria-hidden="true" />
        {pick("查看来源标识", "View source identifiers")}
      </summary>
      <p className="mt-1 break-all font-mono">{ids.join(" · ")}</p>
    </details>
  );
}

function CountBadge({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-md bg-slate-100 px-2.5 py-1.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {label} {value}
    </span>
  );
}

function Unavailable({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <p className={`${compact ? "mt-2 text-xs" : "text-sm"} text-slate-400`}>
      {text}
    </p>
  );
}

function RawData({ value }: { value: unknown }) {
  const { pick } = useI18n();
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-slate-500">
        <Braces className="h-4 w-4" aria-hidden="true" />
        {pick("技术原始数据", "Raw technical data")}
        <ArrowRight className="ml-auto h-3.5 w-3.5" aria-hidden="true" />
      </summary>
      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-5 text-slate-600 dark:bg-slate-950 dark:text-slate-300">
        {jsonText(value)}
      </pre>
    </details>
  );
}

export { RawData as BlueprintRawData };
