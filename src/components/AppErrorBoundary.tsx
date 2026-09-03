import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryState {
  failed: boolean;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("AiPin 界面进入安全恢复状态", error.name, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-ui" role="alert">
        <img src="/icon.svg" alt="" />
        <h1>界面已进入安全恢复状态</h1>
        <p>本地数据和 API Key 没有被删除。请重新加载界面；若问题持续出现，可从托盘退出后重新启动 AiPin。</p>
        <button type="button" onClick={() => window.location.reload()}>重新加载界面</button>
      </main>
    );
  }
}
