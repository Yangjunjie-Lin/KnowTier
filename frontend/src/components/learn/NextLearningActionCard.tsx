import { ArrowRight, Clock3, Sparkles, Target } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import type { LearningPlan, LearningPriority } from "@/types/api";

export function NextLearningActionCard({
  plan,
  source = "overview",
}: {
  plan: LearningPlan;
  source?: string;
}) {
  const { pick } = useI18n();
  const focus = plan.focus;
  if (!focus) return null;
  return (
    <section
      className="relative mt-5 overflow-hidden rounded-3xl border border-indigo-200/80 bg-[linear-gradient(120deg,#172554_0%,#233b91_55%,#3157d5_100%)] p-5 text-white shadow-[0_20px_55px_rgba(30,58,138,0.22)] sm:p-6"
      aria-labelledby="next-learning-action-title"
    >
      <div
        className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-blue-300/20 blur-3xl"
        aria-hidden="true"
      />
      <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] xl:items-center">
        <div>
          <p className="inline-flex items-center gap-1.5 text-xs font-bold tracking-[0.16em] text-indigo-100 uppercase">
            <Sparkles className="h-3.5 w-3.5" />
            {pick("今天最值得学", "Your best next action")}
          </p>
          <h2
            id="next-learning-action-title"
            className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl"
          >
            {focus.knowledge_point}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-indigo-100">
            {overviewPriorityDescription(
              focus.priority,
              focus.unlocks_topic_count,
              pick,
            )}
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 backdrop-blur">
              <Clock3 className="h-3.5 w-3.5" />
              {pick(`${plan.total_minutes} 分钟`, `${plan.total_minutes} min`)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 backdrop-blur">
              <Target className="h-3.5 w-3.5" />
              {pick(`目标 L${focus.target_level}`, `Target L${focus.target_level}`)}
            </span>
          </div>
          <Link
            to="/learn"
            state={{
              learningTarget: {
                id: focus.knowledge_point_id,
                name: focus.knowledge_point,
                source,
                mode: focus.requested_mode,
                priority: focus.priority,
                totalMinutes: plan.total_minutes,
              },
            }}
            className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 py-2 text-sm font-bold text-[#2446B8] shadow-lg transition hover:-translate-y-px hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {pick(
              `开始 ${plan.total_minutes} 分钟学习`,
              `Start ${plan.total_minutes}-minute session`,
            )}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <ol className="grid gap-2 rounded-2xl border border-white/15 bg-slate-950/20 p-3 backdrop-blur sm:grid-cols-3 xl:grid-cols-1">
          {plan.steps.map((step, index) => (
            <li
              key={step.phase}
              className="flex min-w-0 items-center gap-3 rounded-xl bg-white/10 px-3 py-2.5"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-[#3157D5]">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">
                  {step.phase === "activate"
                    ? pick("激活旧知", "Activate")
                    : step.phase === "build"
                      ? pick("建立理解", "Build")
                      : pick("独立检测", "Check")}
                </p>
                <p className="mt-0.5 text-xs text-indigo-100">
                  {step.minutes} min
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

type PickCopy = (zh: string, en: string) => string;

function overviewPriorityDescription(
  priority: LearningPriority,
  unlocks: number,
  pick: PickCopy,
): string {
  if (priority === "correct_misconception") {
    return pick(
      "先纠正仍在影响理解的关键误解，再继续后续知识。",
      "Correct an active misconception before building further knowledge.",
    );
  }
  if (priority === "review_due") {
    return pick(
      "这个主题已到复习时间，用主动回忆巩固长期记忆。",
      "This topic is due; use active recall to strengthen retention.",
    );
  }
  if (priority === "unlock_prerequisite") {
    return pick(
      `先完成这个前置主题，可解锁后续 ${unlocks} 个学习节点。`,
      `Complete this prerequisite to unlock ${unlocks} later topic${unlocks === 1 ? "" : "s"}.`,
    );
  }
  if (priority === "remediate_foundation") {
    return pick(
      "当前证据显示基础仍不稳定，本轮将换一种表示并针对练习。",
      "Current evidence shows an unstable foundation; rebuild it through targeted practice.",
    );
  }
  if (priority === "continue_practice") {
    return pick(
      "已有学习证据，继续练习可把理解变得稳定而独立。",
      "You have learning evidence; another practice round can make it stable and independent.",
    );
  }
  if (priority === "deepen_mastery") {
    return pick(
      "提升到下一认知层级，并通过迁移任务检验真正掌握。",
      "Move to the next cognitive level and verify mastery through transfer.",
    );
  }
  return pick(
    "这是当前路径中前置已就绪、最适合开始的主题。",
    "This is the best unstarted topic whose prerequisites are ready.",
  );
}
