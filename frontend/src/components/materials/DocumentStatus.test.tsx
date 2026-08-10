import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocumentStatus, documentStatusLabel } from "./DocumentStatus";

describe("DocumentStatus", () => {
  it.each([
    ["UPLOADED", "已上传"],
    ["PARSING", "处理中"],
    ["INGESTED", "可用于学习"],
    ["FAILED", "处理失败"],
  ])("renders %s as a readable label", (status, label) => {
    render(<DocumentStatus status={status} />);
    expect(
      screen.getByLabelText(`处理状态：${label}`),
    ).toHaveTextContent(label);
  });

  it("does not expose an unknown internal value", () => {
    expect(documentStatusLabel("INTERNAL_NEW_STATE")).toBe("状态未知");
  });
});
