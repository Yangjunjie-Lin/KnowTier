import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";

function BrokenView(): never {
  throw new Error("sensitive internal failure");
}

describe("AppErrorBoundary", () => {
  it("replaces a crashed view with a safe recovery surface", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <AppErrorBoundary>
        <BrokenView />
      </AppErrorBoundary>,
    );

    expect(
      screen.getByRole("heading", { name: "当前页面没有正常显示" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新加载" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回开始页" })).toBeInTheDocument();
    expect(screen.queryByText("sensitive internal failure")).not.toBeInTheDocument();

    consoleError.mockRestore();
  });
});
