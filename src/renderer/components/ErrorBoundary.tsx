import type React from "react";
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/** Top-level error boundary — catches render crashes and shows a recovery screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-inner">
            <h1>Something went wrong</h1>
            <p className="error-boundary-msg">
              {this.state.error?.message ?? "An unexpected error occurred."}
            </p>
            {this.state.error?.stack && (
              <details className="error-boundary-details">
                <summary>Error details</summary>
                <pre>{this.state.error.stack}</pre>
              </details>
            )}
            <button className="btn-primary" onClick={this.handleReload}>
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
