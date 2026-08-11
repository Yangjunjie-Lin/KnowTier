import type { CognitiveLevel } from "@/types/api";

export const cognitiveLevels: Array<{
  id: CognitiveLevel;
  code: string;
  name: string;
  description: string;
  nameEn: string;
  descriptionEn: string;
  color: string;
  soft: string;
}> = [
  {
    id: 1,
    code: "L1",
    name: "直观认知",
    description: "识别与描述概念的基本特征",
    nameEn: "Recognition",
    descriptionEn: "Recognize and describe the key features of a concept",
    color: "#3157D5",
    soft: "#EEF2FF",
  },
  {
    id: 2,
    code: "L2",
    name: "引导模仿",
    description: "在引导下复现典型步骤",
    nameEn: "Guided practice",
    descriptionEn: "Reproduce a typical process with guidance",
    color: "#2748B8",
    soft: "#E8EEFF",
  },
  {
    id: 3,
    code: "L3",
    name: "概念理解",
    description: "用自己的语言解释原理",
    nameEn: "Understanding",
    descriptionEn: "Explain the principle in your own words",
    color: "#1F3F9E",
    soft: "#E2E9FF",
  },
  {
    id: 4,
    code: "L4",
    name: "独立应用",
    description: "在新场景中独立解决问题",
    nameEn: "Independent application",
    descriptionEn: "Apply the concept independently in a new situation",
    color: "#1A368A",
    soft: "#DDE5FF",
  },
  {
    id: 5,
    code: "L5",
    name: "批判迁移",
    description: "评估、分析并迁移知识",
    nameEn: "Critical transfer",
    descriptionEn: "Evaluate, analyze, and transfer knowledge",
    color: "#152C75",
    soft: "#D7DFFF",
  },
  {
    id: 6,
    code: "L6",
    name: "创造研究",
    description: "提出新方案或开展研究",
    nameEn: "Creation and research",
    descriptionEn: "Create a new approach or conduct original research",
    color: "#10225F",
    soft: "#D0D8F8",
  },
];
