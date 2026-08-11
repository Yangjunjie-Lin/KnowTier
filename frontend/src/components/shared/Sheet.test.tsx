import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet";

describe("Sheet", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.lang = "zh-CN";
  });

  it.each([
    ["zh-CN", "关闭详情"],
    ["en", "Close details"],
  ] as const)("localizes the close action for %s", (locale, closeLabel) => {
    document.documentElement.lang = locale;
    render(
      <Sheet
        open
        onOpenChange={vi.fn()}
        title="Details"
        description="Detail panel"
      >
        <p>Content</p>
      </Sheet>,
    );

    expect(screen.getByRole("button", { name: closeLabel })).toBeInTheDocument();
  });
});
