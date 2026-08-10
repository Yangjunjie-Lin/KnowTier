import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorState } from "./ErrorState";

describe("ErrorState", () => {
  it("shows retry and a contextual recovery action together", () => {
    const retry = vi.fn();
    const recover = vi.fn();

    render(
      <ErrorState
        error={new Error("读取失败")}
        onRetry={retry}
        action={
          <button type="button" onClick={recover}>
            重新初始化
          </button>
        }
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    fireEvent.click(screen.getByRole("button", { name: "重新初始化" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledOnce();
  });
});
