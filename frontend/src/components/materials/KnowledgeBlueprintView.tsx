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

export function KnowledgeBlueprintView({ value }: { value: unknown }) {
  const blueprint = adaptKnowledgeBlueprint(value);
  if (!blueprint) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        知识蓝图数据格式异常，当前无法生成结构化视图。
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
                知识蓝图
              </span>
            </div>
            <h2 className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">
              {blueprint.title}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {blueprint.domain
                ? `领域：${blueprint.domain}`
                : "尚未标注所属领域"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <CountBadge label="理论" value={blueprint.theories.length} />
            <CountBadge label="知识点" value={blueprint.knowledgePoints.length} />
            <CountBadge label="关系" value={blueprint.relations.length} />
            <CountBadge label="歧义" value={blueprint.ambiguities.length} />
          </div>
        </div>
      </section>

      {blueprint.theories.length > 0 && (
        <ContentSection icon={ScrollText} title="理论">
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
                      置信度 {displayPercent(theory.confidence)}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {theory.description ?? "暂无理论说明"}
                </p>
                <SourceIds ids={theory.sourceSpanIds} />
              </article>
            ))}
          </div>
        </ContentSection>
      )}

      <ContentSection icon={GraduationCap} title="知识点">
        {blueprint.knowledgePoints.length > 0 ? (
          <div className="space-y-4">
            {blueprint.knowledgePoints.map((point) => (
              <KnowledgePointCard key={point.candidateKey} point={point} />
            ))}
          </div>
        ) : (
          <Unavailable text="Blueprint 中没有知识点记录" />
        )}
      </ContentSection>

      {blueprint.relations.length > 0 && (
        <ContentSection icon={Waypoints} title="知识关系">
          <div className="space-y-2">
            {blueprint.relations.map((relation, index) => (
              <article
                key={`${relation.subjectCandidateId}-${relation.predicate}-${relation.objectCandidateId}-${index}`}
                className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
              >
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {relation.description}
                </p>
                <p className="mt-1 font-mono text-[10px] text-slate-400">
                  {relation.subjectCandidateId} → {relation.predicate} →{" "}
                  {relation.objectCandidateId}
                  {relation.confidence !== null
                    ? ` · ${displayPercent(relation.confidence)}`
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
        <ContentSection icon={CircleHelp} title="未关联到已知知识点的内容">
          <p className="mb-3 text-xs text-slate-500">
            以下内容尚未关联到已知知识点，可能是关联信息缺失或对应知识点尚未生成。
          </p>
          <SupplementaryContent
            examples={unassignedExamples}
            counterexamples={unassignedCounterexamples}
            misconceptions={unassignedMisconceptions}
            assessments={unassignedAssessments}
          />
        </ContentSection>
      )}

      <ContentSection icon={Quote} title="来源">
        {blueprint.sourceSpanIds.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {blueprint.sourceSpanIds.map((id) => (
              <code
                key={id}
                className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                SourceSpan {id}
              </code>
            ))}
          </div>
        ) : (
          <Unavailable text="暂无可追溯来源" />
        )}
      </ContentSection>

      <ContentSection icon={AlertTriangle} title="冲突或未解决歧义">
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
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                    涉及候选：{item.candidateKeys.join("、")}
                  </p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            暂无未解决歧义
          </p>
        )}
      </ContentSection>

      <RawData value={blueprint.raw} />
    </div>
  );
}

function KnowledgePointCard({ point }: { point: BlueprintKnowledgePoint }) {
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
              查看候选标识
            </summary>
            <code className="mt-1 block break-all text-[10px] text-slate-400">
              {point.candidateKey}
            </code>
          </details>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          {point.importance !== null && (
            <span className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">
              重要度 {displayPercent(point.importance)}
            </span>
          )}
          {point.difficulty !== null && (
            <span className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">
              难度 {displayPercent(point.difficulty)}
            </span>
          )}
          {point.confidence !== null && (
            <span className="rounded bg-indigo-50 px-2 py-1 text-[#3157D5] dark:bg-indigo-950">
              置信度 {displayPercent(point.confidence)}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <LabeledBlock label="简明定义" value={point.plainDefinition} />
        <LabeledBlock label="正式定义" value={point.formalDefinition} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <Subheading icon={GitBranch}>前置知识</Subheading>
          {point.prerequisites.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {point.prerequisites.map((item) => (
                <span
                  key={item.key}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
                  title={item.key}
                >
                  {item.name}
                </span>
              ))}
            </div>
          ) : (
            <Unavailable text="后端未列出前置知识" compact />
          )}
        </div>
        <div>
          <Subheading icon={FlaskConical}>方法</Subheading>
          {point.methods.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
              {point.methods.map((method) => (
                <li key={method}>· {method}</li>
              ))}
            </ul>
          ) : (
            <Unavailable text="六级计划中未提供教学方法" compact />
          )}
        </div>
      </div>

      {(point.mustCover.length > 0 || point.commonConfusions.length > 0) && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <TagGroup title="必须覆盖" values={point.mustCover} />
          <TagGroup title="常见混淆" values={point.commonConfusions} />
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
            六级教学内容（{point.stages.length}）
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
                      ? `${level.code} · ${level.name}`
                      : stage.cognitiveLevel !== null
                        ? `L${stage.cognitiveLevel}`
                        : "层级未提供"}
                  </p>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                    {stage.learningObjective ?? "暂无学习目标"}
                  </p>
                  {stage.diagnosticQuestion && (
                    <p className="mt-2 text-xs text-slate-500">
                      掌握检测：{stage.diagnosticQuestion}
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
          开始学习
        </Link>
        {point.graphNodeId ? (
          <Link
            to={`/graph/domain?node=${encodeURIComponent(point.graphNodeId)}`}
            className="secondary-button"
          >
            <Link2 className="h-4 w-4" aria-hidden="true" />
            在图谱中查看
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
              在图谱中查看
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
        <MiniSection icon={Lightbulb} title="示例">
          {examples.map((item) => (
            <p key={item.candidateKey}>{item.content}</p>
          ))}
        </MiniSection>
      )}
      {counterexamples.length > 0 && (
        <MiniSection icon={ShieldAlert} title="反例">
          {counterexamples.map((item) => (
            <div key={item.candidateKey}>
              <p>{item.content}</p>
              {item.boundaryExplained && (
                <p className="mt-1 text-xs text-slate-500">
                  边界：{item.boundaryExplained}
                </p>
              )}
            </div>
          ))}
        </MiniSection>
      )}
      {misconceptions.length > 0 && (
        <MiniSection icon={AlertTriangle} title="误解">
          {misconceptions.map((item) => (
            <div key={item.candidateKey}>
              <p>{item.statement}</p>
              {item.correction && (
                <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                  纠正：{item.correction}
                </p>
              )}
            </div>
          ))}
        </MiniSection>
      )}
      {assessments.length > 0 && (
        <MiniSection icon={CircleHelp} title="掌握检测">
          {assessments.map((item) => (
            <div key={item.candidateKey}>
              <p>{item.question}</p>
              {item.successCriteria.length > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  通过标准：{item.successCriteria.join("；")}
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
  return (
    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">
        {value ?? "暂无"}
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
    <p className="mt-3 flex items-start gap-1.5 break-all text-[10px] text-slate-400">
      <Quote className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      {ids.join(" · ")}
    </p>
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
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-slate-500">
        <Braces className="h-4 w-4" aria-hidden="true" />
        技术原始数据
        <ArrowRight className="ml-auto h-3.5 w-3.5" aria-hidden="true" />
      </summary>
      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-5 text-slate-600 dark:bg-slate-950 dark:text-slate-300">
        {jsonText(value)}
      </pre>
    </details>
  );
}

export { RawData as BlueprintRawData };
