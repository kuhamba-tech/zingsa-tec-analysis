"use client";

import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page-stack">
          <div className="banner banner-alert">
            <h2 className="page-title" style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>
              This page hit an unexpected error
            </h2>
            <p style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
              {this.state.error.message || "The view crashed while rendering. Cached live data is still kept."}
            </p>
            <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
