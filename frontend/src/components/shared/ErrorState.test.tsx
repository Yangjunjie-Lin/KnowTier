import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorState } from "./ErrorState";
import { UserFacingError } from "@/lib/api/errors";

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

  it("does not make an unexpected technical error the primary user message", () => {
    render(<ErrorState error={new Error("ECONNREFUSED: database internal")} />);

    expect(
      screen.getAllByText("服务暂时无法完成请求，请稍后重试。").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("ECONNREFUSED: database internal")).not.toBeInTheDocument();
  });

  it("shows an explicitly safe client validation message", () => {
    render(<ErrorState error={new UserFacingError("请输入有效的学习空间标识。")} />);

    expect(screen.getByText("请输入有效的学习空间标识。")).toBeInTheDocument();
  });
});
