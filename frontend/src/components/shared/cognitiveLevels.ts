import type { CognitiveLevel } from "@/types/api";

export const cognitiveLevels: Array<{
  id: CognitiveLevel;
  code: string;
  name: string;
  description: string;
  color: string;
  soft: string;
}> = [
  {
    id: 1,
    code: "L1",
    name: "直观认知",
    description: "识别与描述概念的基本特征",
    color: "#93B5F5",
    soft: "#EEF2FF",
  },
  {
    id: 2,
    code: "L2",
    name: "引导模仿",
    description: "在引导下复现典型步骤",
    color: "#7B96EF",
    soft: "#E0EAFE",
  },
  {
    id: 3,
    code: "L3",
    name: "概念理解",
    description: "用自己的语言解释原理",
    color: "#5577E8",
    soft: "#C7D7F8",
  },
  {
    id: 4,
    code: "L4",
    name: "独立应用",
    description: "在新场景中独立解决问题",
    color: "#3157D5",
    soft: "#DDE5FF",
  },
  {
    id: 5,
    code: "L5",
    name: "批判迁移",
    description: "评估、分析并迁移知识",
    color: "#2446B8",
    soft: "#D7DFFF",
  },
  {
    id: 6,
    code: "L6",
    name: "创造研究",
    description: "提出新方案或开展研究",
    color: "#1E3A9E",
    soft: "#D5DBF8",
  },
];
