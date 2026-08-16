import {
  Archive,
  BookOpen,
  Brain,
  Compass,
  History,
  Home,
  Network,
  Search,
  Settings,
  Target,
  type LucideIcon,
} from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";

export interface NavigationItem {
  key: string;
  labelKey: TranslationKey;
  path: string;
  icon: LucideIcon;
  group: "learning" | "progress" | "tools";
  mobile?: boolean;
}

export const navigationGroups = [
  { key: "learning", zh: "开始", en: "Start" },
  { key: "progress", zh: "了解我的学习", en: "Understand progress" },
  { key: "tools", zh: "更多", en: "More" },
] as const;

export const navigationItems: NavigationItem[] = [
  {
    key: "overview",
    labelKey: "nav.overview",
    path: "/overview",
    icon: Home,
    group: "learning",
    mobile: true,
  },
  {
    key: "learn",
    labelKey: "nav.learn",
    path: "/learn",
    icon: BookOpen,
    group: "learning",
    mobile: true,
  },
  {
    key: "materials",
    labelKey: "nav.materials",
    path: "/materials",
    icon: Archive,
    group: "learning",
    mobile: true,
  },
  {
    key: "personal-model",
    labelKey: "nav.personalModel",
    path: "/model",
    icon: Brain,
    group: "progress",
    mobile: true,
  },
  {
    key: "learning-path",
    labelKey: "nav.learningPath",
    path: "/learning-path",
    icon: Compass,
    group: "progress",
    mobile: true,
  },
  {
    key: "domain-graph",
    labelKey: "nav.domainGraph",
    path: "/graph/domain",
    icon: Network,
    group: "progress",
  },
  {
    key: "student-graph",
    labelKey: "nav.studentGraph",
    path: "/graph/student",
    icon: Target,
    group: "progress",
  },
  {
    key: "search",
    labelKey: "nav.search",
    path: "/search",
    icon: Search,
    group: "tools",
  },
  {
    key: "history",
    labelKey: "nav.history",
    path: "/history/domain",
    icon: History,
    group: "tools",
  },
  {
    key: "settings",
    labelKey: "nav.settings",
    path: "/settings",
    icon: Settings,
    group: "tools",
  },
];
