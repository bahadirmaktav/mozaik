import { Component, type ReactNode } from "react";

export class PluginBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="plugin-error" role="alert">
        <p>
          The editor view could not be displayed. Your document is still in
          memory; use Save As to preserve it.
        </p>
        <button onClick={() => this.setState({ failed: false })}>
          Retry view
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
