import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MasteryBar } from "./MasteryBar";

describe("MasteryBar", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.lang = "zh-CN";
  });

  it("renders the default labels in Chinese", () => {
    document.documentElement.lang = "zh-CN";
    render(<MasteryBar value={0.62} confidence={0.88} />);

    expect(screen.getByText("掌握度")).toBeInTheDocument();
    expect(screen.getByText("置信度 88%")).toBeInTheDocument();
  });

  it("switches shared mastery labels to English", () => {
    document.documentElement.lang = "en";
    render(<MasteryBar value={0.62} confidence={0.88} />);

    expect(screen.getByText("Mastery")).toBeInTheDocument();
    expect(screen.getByText("Confidence 88%")).toBeInTheDocument();
    expect(screen.queryByText(/置信度|掌握度/)).not.toBeInTheDocument();
  });
});
