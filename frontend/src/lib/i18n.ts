import { useCallback, useMemo } from "react";
import { useOptionalAppStore } from "@/stores/AppContext";
import type { UiLocale } from "@/types/app";

const zhCN = {
  "common.back": "返回",
  "common.cancel": "取消",
  "common.close": "关闭",
  "common.confirm": "确认",
  "common.clear": "清除",
  "common.delete": "删除",
  "common.details": "查看详情",
  "common.done": "完成",
  "common.edit": "编辑",
  "common.export": "导出",
  "common.loading": "正在加载",
  "common.more": "更多",
  "common.none": "暂无",
  "common.refresh": "刷新",
  "common.retry": "重试",
  "common.save": "保存",
  "common.search": "搜索",
  "common.settings": "设置",
  "common.unknown": "其他",
  "common.yes": "是",
  "common.no": "否",
  "nav.overview": "总览",
  "nav.learn": "开始学习",
  "nav.search": "搜索",
  "nav.materials": "资料库",
  "nav.domainGraph": "知识全景",
  "nav.personalModel": "我的进度",
  "nav.studentGraph": "我的知识地图",
  "nav.learningPath": "学习路径",
  "nav.history": "变化记录",
  "nav.settings": "设置",
  "shell.productTagline": "你的个人学习助手",
  "shell.noWorkspace": "未选择学习空间",
  "shell.learner": "学习档案：{name}",
  "shell.finishSetup": "请先完成初始化",
  "shell.openNavigation": "打开导航",
  "shell.closeNavigation": "关闭导航",
  "shell.expandNavigation": "展开侧栏",
  "shell.collapseNavigation": "收起侧栏",
  "shell.primaryNavigation": "主导航",
  "shell.mobileNavigation": "移动端导航",
  "shell.skipToContent": "跳到主要内容",
  "shell.openSearch": "打开全局搜索",
  "shell.searchTitle": "全局搜索（Ctrl/⌘ + K）",
  "shell.interfaceLanguage": "界面语言",
  "shell.languageChinese": "中文",
  "shell.languageEnglish": "English",
  "state.loading": "正在获取最新数据",
  "state.empty": "暂时没有内容",
  "state.error": "暂时无法加载",
  "state.partial": "部分内容暂时不可用",
  "status.ready": "可以开始",
  "status.inProgress": "进行中",
  "status.completed": "已完成",
  "status.failed": "需要重试",
  "status.pending": "等待处理",
  "status.verified": "已确认",
  "status.unverified": "待确认",
  "status.mastered": "已掌握",
  "status.needsReview": "建议复习",
  "status.blocked": "需先补足前置知识",
  "entity.knowledgePoint": "知识点",
  "entity.concept": "概念",
  "entity.theory": "原理",
  "entity.definition": "定义",
  "entity.method": "方法",
  "entity.example": "示例",
  "entity.misconception": "常见误解",
  "entity.unknown": "学习内容",
  "relation.requires": "需要先掌握",
  "relation.prerequisite": "是前置知识",
  "relation.contains": "包含",
  "relation.related": "相关",
  "relation.supports": "帮助理解",
  "relation.contradicts": "容易混淆",
  "relation.evidence": "由此证明",
  "relation.unknown": "有关联",
  "evidence.answer": "学习回答",
  "evidence.assessment": "掌握检测",
  "evidence.document": "学习资料",
  "evidence.teacher": "教学记录",
  "evidence.unknown": "学习记录",
  "provider.mock": "离线模拟",
  "provider.siliconflow": "SiliconFlow",
  "provider.custom": "自定义兼容服务",
  "provider.unknown": "模型服务",
  "model.teacher": "教学模型",
  "model.extractor": "知识提取模型",
  "model.grader": "掌握评估模型",
  "model.graph": "图谱分析模型",
  "model.vision": "图像理解模型",
  "model.embedding": "向量模型",
  "model.unknown": "运行模型",
} as const;

const en: Record<keyof typeof zhCN, string> = {
  "common.back": "Back",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.confirm": "Confirm",
  "common.clear": "Clear",
  "common.delete": "Delete",
  "common.details": "View details",
  "common.done": "Done",
  "common.edit": "Edit",
  "common.export": "Export",
  "common.loading": "Loading",
  "common.more": "More",
  "common.none": "None yet",
  "common.refresh": "Refresh",
  "common.retry": "Retry",
  "common.save": "Save",
  "common.search": "Search",
  "common.settings": "Settings",
  "common.unknown": "Other",
  "common.yes": "Yes",
  "common.no": "No",
  "nav.overview": "Overview",
  "nav.learn": "Learning",
  "nav.search": "Search",
  "nav.materials": "Materials",
  "nav.domainGraph": "Domain map",
  "nav.personalModel": "My progress",
  "nav.studentGraph": "My knowledge map",
  "nav.learningPath": "Learning path",
  "nav.history": "Version history",
  "nav.settings": "Settings",
  "shell.productTagline": "Your personal learning assistant",
  "shell.noWorkspace": "No workspace selected",
  "shell.learner": "Profile: {name}",
  "shell.finishSetup": "Complete setup to continue",
  "shell.openNavigation": "Open navigation",
  "shell.closeNavigation": "Close navigation",
  "shell.expandNavigation": "Expand sidebar",
  "shell.collapseNavigation": "Collapse sidebar",
  "shell.primaryNavigation": "Primary navigation",
  "shell.mobileNavigation": "Mobile navigation",
  "shell.skipToContent": "Skip to main content",
  "shell.openSearch": "Open global search",
  "shell.searchTitle": "Global search (Ctrl/⌘ + K)",
  "shell.interfaceLanguage": "Interface language",
  "shell.languageChinese": "中文",
  "shell.languageEnglish": "English",
  "state.loading": "Getting the latest data",
  "state.empty": "Nothing here yet",
  "state.error": "This content is temporarily unavailable",
  "state.partial": "Some content is temporarily unavailable",
  "status.ready": "Ready to start",
  "status.inProgress": "In progress",
  "status.completed": "Completed",
  "status.failed": "Needs retry",
  "status.pending": "Pending",
  "status.verified": "Confirmed",
  "status.unverified": "Needs confirmation",
  "status.mastered": "Mastered",
  "status.needsReview": "Review recommended",
  "status.blocked": "Complete prerequisites first",
  "entity.knowledgePoint": "Knowledge point",
  "entity.concept": "Concept",
  "entity.theory": "Principle",
  "entity.definition": "Definition",
  "entity.method": "Method",
  "entity.example": "Example",
  "entity.misconception": "Common misconception",
  "entity.unknown": "Learning topic",
  "relation.requires": "Requires",
  "relation.prerequisite": "Prerequisite for",
  "relation.contains": "Contains",
  "relation.related": "Related to",
  "relation.supports": "Supports understanding of",
  "relation.contradicts": "Often confused with",
  "relation.evidence": "Supported by",
  "relation.unknown": "Related",
  "evidence.answer": "Learner answer",
  "evidence.assessment": "Mastery check",
  "evidence.document": "Learning material",
  "evidence.teacher": "Teaching record",
  "evidence.unknown": "Learning record",
  "provider.mock": "Offline mock",
  "provider.siliconflow": "SiliconFlow",
  "provider.custom": "Custom compatible service",
  "provider.unknown": "Model service",
  "model.teacher": "Teaching model",
  "model.extractor": "Knowledge extraction model",
  "model.grader": "Mastery grading model",
  "model.graph": "Graph analysis model",
  "model.vision": "Vision model",
  "model.embedding": "Embedding model",
  "model.unknown": "Runtime model",
};

export type TranslationKey = keyof typeof zhCN;
type TranslationValues = Record<string, string | number>;

function interpolate(template: string, values?: TranslationValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (token, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : token,
  );
}

export function translate(
  locale: UiLocale,
  key: TranslationKey,
  values?: TranslationValues,
): string {
  return interpolate((locale === "en" ? en : zhCN)[key], values);
}

export function localize(locale: UiLocale, chinese: string, english: string): string {
  return locale === "en" ? english : chinese;
}

const enumAliases: Record<string, TranslationKey> = {
  READY: "status.ready",
  IN_PROGRESS: "status.inProgress",
  PROCESSING: "status.inProgress",
  COMPLETED: "status.completed",
  SUCCEEDED: "status.completed",
  FAILED: "status.failed",
  PENDING: "status.pending",
  VERIFIED: "status.verified",
  UNVERIFIED: "status.unverified",
  MASTERED: "status.mastered",
  NEEDS_REVIEW: "status.needsReview",
  BLOCKED: "status.blocked",
  KNOWLEDGEPOINT: "entity.knowledgePoint",
  KNOWLEDGE_POINT: "entity.knowledgePoint",
  CONCEPT: "entity.concept",
  THEORY: "entity.theory",
  DEFINITION: "entity.definition",
  METHOD: "entity.method",
  EXAMPLE: "entity.example",
  MISCONCEPTION: "entity.misconception",
  REQUIRES: "relation.requires",
  PREREQUISITE: "relation.prerequisite",
  PREREQUISITE_OF: "relation.prerequisite",
  CONTAINS: "relation.contains",
  RELATED_TO: "relation.related",
  SUPPORTS: "relation.supports",
  CONTRADICTS: "relation.contradicts",
  EVIDENCED_BY: "relation.evidence",
  ANSWER: "evidence.answer",
  ASSESSMENT: "evidence.assessment",
  DOCUMENT: "evidence.document",
  TEACHER: "model.teacher",
  EXTRACTOR: "model.extractor",
  GRADER: "model.grader",
  GRAPH: "model.graph",
  VISION: "model.vision",
  EMBEDDING: "model.embedding",
  MOCK: "provider.mock",
  MOCK_PROVIDER: "provider.mock",
  SILICONFLOW: "provider.siliconflow",
  OPENAI_COMPATIBLE: "provider.custom",
  CUSTOM: "provider.custom",
};

export function backendLabel(
  value: string | null | undefined,
  locale: UiLocale,
  fallbackKey: TranslationKey = "common.unknown",
): string {
  const normalized = value?.trim().replace(/[\s-]+/g, "_").toUpperCase();
  const key = normalized ? enumAliases[normalized] : undefined;
  return translate(locale, key ?? fallbackKey);
}

export function relationLabel(value: string | null | undefined, locale: UiLocale): string {
  return backendLabel(value, locale, "relation.unknown");
}

export function entityLabel(value: string | null | undefined, locale: UiLocale): string {
  return backendLabel(value, locale, "entity.unknown");
}

export function evidenceLabel(value: string | null | undefined, locale: UiLocale): string {
  return backendLabel(value, locale, "evidence.unknown");
}

export function providerLabel(value: string | null | undefined, locale: UiLocale): string {
  return backendLabel(value, locale, "provider.unknown");
}

export function modelRoleLabel(value: string | null | undefined, locale: UiLocale): string {
  return backendLabel(value, locale, "model.unknown");
}

export function useI18n() {
  const store = useOptionalAppStore();
  const locale: UiLocale =
    store?.preferences.uiLocale ??
    (typeof document !== "undefined" && document.documentElement.lang === "en"
      ? "en"
      : "zh-CN");
  const setLocale = useCallback(
    (next: UiLocale) => {
      if (store) store.setUiLocale(next);
      else if (typeof document !== "undefined") document.documentElement.lang = next;
    },
    [store],
  );
  const t = useCallback(
    (key: TranslationKey, values?: TranslationValues) =>
      translate(locale, key, values),
    [locale],
  );
  const pick = useCallback(
    (chinese: string, english: string) => localize(locale, chinese, english),
    [locale],
  );

  return useMemo(
    () => ({ locale, isEnglish: locale === "en", setLocale, t, pick }),
    [locale, pick, setLocale, t],
  );
}
