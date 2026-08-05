import type { LocalPreferences } from "@/types/app";

export type QuickTeachingActionId =
  | "not-understood"
  | "hint"
  | "re-explain"
  | "example"
  | "prerequisites";

export interface QuickTeachingAction {
  id: QuickTeachingActionId;
  label: string;
  prompt: (preferences: LocalPreferences) => string;
}

const detailWords = {
  concise: "更简洁地",
  balanced: "换一个角度",
  detailed: "更详细、分步骤地",
} as const;

const hintPrompts = {
  light: "请只给我一个方向性提示，不要直接给出答案。",
  balanced: "请给我一个分步骤提示，并保留关键一步让我完成。",
  strong: "请给我一个更明确的结构化提示，但先不要直接给出完整答案。",
} as const;

export const quickTeachingActions: readonly QuickTeachingAction[] = [
  {
    id: "not-understood",
    label: "我没理解",
    prompt: () => "我还没有理解刚才的讲解，请先帮我定位卡住的地方。",
  },
  {
    id: "hint",
    label: "给我一个提示",
    prompt: (preferences) => hintPrompts[preferences.hintStrength],
  },
  {
    id: "re-explain",
    label: "换一种解释",
    prompt: (preferences) =>
      `请${detailWords[preferences.explanationDetail]}重新解释这个知识点。`,
  },
  {
    id: "example",
    label: "给我一个例子",
    prompt: (preferences) =>
      preferences.prioritizeExamples
        ? "请先给我一个具体例子，再说明它与概念的对应关系。"
        : "请给我一个具体例子，并说明它为什么符合这个概念。",
  },
  {
    id: "prerequisites",
    label: "检查前置知识",
    prompt: () => "请检查我是否缺少理解当前知识点所需的前置知识。",
  },
];

export function mergeQuickPrompt(draft: string, prompt: string): string {
  const current = draft.trimEnd();
  return current ? `${current}\n${prompt}` : prompt;
}
