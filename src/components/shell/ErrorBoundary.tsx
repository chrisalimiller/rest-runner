import { Component, type ErrorInfo, type ReactNode } from "react";
import { clearViewState } from "../../lib/storage";
import "./shell.css";

interface State {
  error: Error | null;
}

/**
 * Catches a render crash anywhere in the app and shows a way out, instead of a blank window.
 * "Reset view state" clears only what the screen remembers (open sections, the draft, what was open);
 * collections, environments, suites, flows and runs are kept.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("REST Runner crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="first-run" role="alert">
        <div className="first-run-card">
          <h1>Something went wrong</h1>
          <p className="muted">REST Runner hit an error it could not recover from. Your saved collections, environments, test suites and flows are not affected.</p>
          <pre className="crash-message">{error.message || String(error)}</pre>
          <p className="muted">If reloading does not help, reset the view state: the request being edited and the remembered layout are cleared, nothing you saved is.</p>
          <div className="crash-actions">
            <button className="primary-outline" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button
              onClick={() => {
                clearViewState();
                window.location.reload();
              }}
            >
              Reset view state and reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
