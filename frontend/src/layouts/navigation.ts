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
  mobile?: boolean;
}

export const navigationItems: NavigationItem[] = [
  {
    key: "overview",
    labelKey: "nav.overview",
    path: "/overview",
    icon: Home,
    mobile: true,
  },
  {
    key: "learn",
    labelKey: "nav.learn",
    path: "/learn",
    icon: BookOpen,
    mobile: true,
  },
  {
    key: "search",
    labelKey: "nav.search",
    path: "/search",
    icon: Search,
  },
  {
    key: "materials",
    labelKey: "nav.materials",
    path: "/materials",
    icon: Archive,
    mobile: true,
  },
  {
    key: "domain-graph",
    labelKey: "nav.domainGraph",
    path: "/graph/domain",
    icon: Network,
  },
  {
    key: "personal-model",
    labelKey: "nav.personalModel",
    path: "/model",
    icon: Brain,
    mobile: true,
  },
  {
    key: "student-graph",
    labelKey: "nav.studentGraph",
    path: "/graph/student",
    icon: Target,
  },
  {
    key: "learning-path",
    labelKey: "nav.learningPath",
    path: "/learning-path",
    icon: Compass,
  },
  { key: "history", labelKey: "nav.history", path: "/history/domain", icon: History },
  {
    key: "settings",
    labelKey: "nav.settings",
    path: "/settings",
    icon: Settings,
    mobile: true,
  },
];
