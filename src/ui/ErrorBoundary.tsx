import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="pane pad" role="alert">
        <p><b>{this.props.label ?? "Error"}</b></p>
        <p>{this.state.err.message}</p>
        <button onClick={() => this.setState({ err: null })}>Retry</button>
      </div>
    );
  }
}
