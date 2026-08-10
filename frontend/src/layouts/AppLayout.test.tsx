import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AppLayout } from "./AppLayout";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

vi.mock("@/stores/AppContext", () => ({
  useAppStore: () => ({
    currentWorkspace: { name: "测试空间" },
    currentLearner: { display_name: "测试学习者", language: "zh-CN" },
  }),
}));

function installViewport(initialMatches = false) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQueryList = {
    get matches() {
      return matches;
    },
    media: "(min-width: 1024px)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
    ),
    removeEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
    ),
    dispatchEvent: vi.fn(() => true),
  } as unknown as MediaQueryList;

  vi.stubGlobal("matchMedia", vi.fn(() => mediaQueryList));
  return {
    setDesktop(next: boolean) {
      matches = next;
      const event = { matches, media: mediaQueryList.media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/overview"]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/overview" element={<h1>页面内容</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function LocationProbe() {
  return <output aria-label="当前位置">{useLocation().pathname}</output>;
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
  vi.unstubAllGlobals();
});

describe("application shell accessibility", () => {
  it("keeps collapsed desktop navigation links named", () => {
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <Sidebar collapsed onToggle={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "总览" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开侧栏" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("moves focus to the main region from the skip link", () => {
    installViewport();
    renderLayout();

    fireEvent.click(screen.getByRole("link", { name: "跳到主要内容" }));

    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("closes the mobile drawer and restores scrolling at the desktop breakpoint", async () => {
    const viewport = installViewport();
    renderLayout();

    fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: /移动端主导航/ }),
      ).toBeInTheDocument(),
    );
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");

    act(() => viewport.setDesktop(true));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /移动端主导航/ }),
      ).not.toBeInTheDocument(),
    );
    expect(document.body.style.overflow).toBe("");
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("opens global search from the shortcut without hijacking form controls", () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <TopBar mobileOpen={false} onMenu={vi.fn()} />
        <label>
          选项
          <select>
            <option>第一项</option>
          </select>
        </label>
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.keyDown(screen.getByRole("combobox", { name: "选项" }), {
      key: "/",
    });
    expect(screen.getByLabelText("当前位置")).toHaveTextContent("/settings");

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "/",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(screen.getByLabelText("当前位置")).toHaveTextContent("/search");
  });
});
