import {
  Archive,
  BookOpen,
  Brain,
  Compass,
  History,
  Home,
  Network,
  Settings,
  Target,
  type LucideIcon,
} from "lucide-react";

export interface NavigationItem {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
  mobile?: boolean;
}

export const navigationItems: NavigationItem[] = [
  {
    key: "overview",
    label: "总览",
    path: "/overview",
    icon: Home,
    mobile: true,
  },
  {
    key: "learn",
    label: "学习空间",
    path: "/learn",
    icon: BookOpen,
    mobile: true,
  },
  {
    key: "materials",
    label: "资料库",
    path: "/materials",
    icon: Archive,
    mobile: true,
  },
  {
    key: "domain-graph",
    label: "领域知识图谱",
    path: "/graph/domain",
    icon: Network,
  },
  {
    key: "personal-model",
    label: "个人模型",
    path: "/model",
    icon: Brain,
    mobile: true,
  },
  {
    key: "student-graph",
    label: "学生知识图谱",
    path: "/graph/student",
    icon: Target,
  },
  {
    key: "learning-path",
    label: "学习路径",
    path: "/learning-path",
    icon: Compass,
  },
  { key: "history", label: "版本记录", path: "/history/domain", icon: History },
  {
    key: "settings",
    label: "设置",
    path: "/settings",
    icon: Settings,
    mobile: true,
  },
];
