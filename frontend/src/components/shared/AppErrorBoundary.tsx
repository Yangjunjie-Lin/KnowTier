import { Component, type ReactNode } from "react";
import { ArrowLeft, RefreshCw, TriangleAlert } from "lucide-react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  failed: boolean;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  override state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  private reload = (): void => {
    window.location.reload();
  };

  private returnHome = (): void => {
    window.location.assign("/");
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const english = document.documentElement.lang === "en";

    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F5F7FB] px-5 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <section
          className="w-full max-w-lg rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.10)] sm:p-8 dark:border-slate-800 dark:bg-slate-900"
          aria-labelledby="app-recovery-title"
          role="alert"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
            <TriangleAlert className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#3157D5]">
            {english ? "Page recovery" : "页面恢复"}
          </p>
          <h1
            id="app-recovery-title"
            className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl"
          >
            {english ? "This page could not be displayed" : "当前页面没有正常显示"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {english
              ? "Your learning data remains on this device. Reload the page first; if the problem continues, return to setup and reopen the workspace."
              : "你的学习数据仍然保存在本设备。请先重新加载；如果问题仍然存在，可返回开始页重新进入学习空间。"}
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <button type="button" className="primary-button justify-center" onClick={this.reload}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {english ? "Reload" : "重新加载"}
            </button>
            <button type="button" className="secondary-button justify-center" onClick={this.returnHome}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {english ? "Back to setup" : "返回开始页"}
            </button>
          </div>
        </section>
      </main>
    );
  }
}
