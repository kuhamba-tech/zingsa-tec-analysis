"use client";

import { Component, type ReactNode } from "react";
import dynamic from "next/dynamic";

const CauseEffectTimelineStack = dynamic(
  () => import("@/components/spaceWeather/CauseEffectTimelineStack"),
  {
    ssr: false,
    loading: () => (
      <div className="banner banner-info" role="status" style={{ margin: "0.75rem 0" }}>
        Loading timelines and CORS map…
      </div>
    ),
  },
);

type State = { error: Error | null; retry: number };

/**
 * Isolates timeline/map chunk-load failures so a bad dynamic import cannot
 * leave the National Dashboard stuck on "Loading timelines and CORS map…".
 */
export default class HomeTimelinesGate extends Component<object, State> {
  state: State = { error: null, retry: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="banner banner-warn" role="alert" style={{ margin: "0.75rem 0" }}>
          Timelines and CORS map failed to load.
          <button
            type="button"
            className="btn"
            style={{ marginLeft: "0.75rem" }}
            onClick={() => this.setState((s) => ({ error: null, retry: s.retry + 1 }))}
          >
            Retry
          </button>
        </div>
      );
    }
    return <CauseEffectTimelineStack key={this.state.retry} />;
  }
}
