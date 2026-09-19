"use client";

import { Component, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { loadCauseEffectTimelineStack } from "@/lib/loadCauseEffectTimeline";

const CauseEffectTimelineStack = dynamic(
  () => loadCauseEffectTimelineStack().then((m) => m.default),
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

  componentDidCatch(error: Error) {
    const message = error?.message ?? "";
    if (/ChunkLoadError|Loading chunk/i.test(message) || error?.name === "ChunkLoadError") {
      try {
        const key = "zgiis:cause-effect-chunk-reload";
        if (sessionStorage.getItem(key) !== "1") {
          sessionStorage.setItem(key, "1");
          window.location.reload();
        }
      } catch {
        /* ignore */
      }
    }
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
            onClick={() => {
              try {
                sessionStorage.removeItem("zgiis:cause-effect-chunk-reload");
              } catch {
                /* ignore */
              }
              this.setState((s) => ({ error: null, retry: s.retry + 1 }));
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return <CauseEffectTimelineStack key={this.state.retry} />;
  }
}
