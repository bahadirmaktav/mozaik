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
          This view could not be displayed. Its document or terminal session is
          still in memory; retry the view to continue.
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
