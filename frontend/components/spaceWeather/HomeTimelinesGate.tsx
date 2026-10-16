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
        Loading CORS map…
      </div>
    ),
  },
);

const LiveMetricTimelines = dynamic(
  () => import("@/components/spaceWeather/LiveMetricTimelines"),
  {
    ssr: false,
    loading: () => (
      <div className="banner banner-info" role="status" style={{ margin: "0.75rem 0" }}>
        Loading live Space Weather graphs…
      </div>
    ),
  },
);

type State = { error: Error | null; retry: number; mounted: boolean };

function TimelinesLoading(): ReactNode {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div className="banner banner-info" role="status" style={{ margin: "0.75rem 0" }}>
        Loading CORS map…
      </div>
      <div className="banner banner-info" role="status" style={{ margin: "0.75rem 0" }}>
        Loading live Space Weather graphs…
      </div>
    </div>
  );
}

/**
 * Home page: same CORS map + Live Metric graphs as Space Weather.
 * Isolates chunk-load failures so a bad dynamic import cannot blank the dashboard.
 *
 * Dynamic charts use `ssr: false`, so we wait until after mount before rendering
 * them — otherwise the server HTML (loading markup) disagrees with the client's
 * Suspense boundary and React throws a hydration error.
 */
export default class HomeTimelinesGate extends Component<object, State> {
  state: State = { error: null, retry: 0, mounted: false };

  componentDidMount() {
    this.setState({ mounted: true });
  }

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
          Live Space Weather graphs failed to load.
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
    if (!this.state.mounted) {
      return <TimelinesLoading />;
    }
    return (
      <div key={this.state.retry} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* Same ionosphere readings + CORS map as Space Weather overview */}
        <CauseEffectTimelineStack variant="overview" />
        {/* Identical Live Metric graph stack as Space Weather → Live Metric Timelines */}
        <LiveMetricTimelines showIntro />
      </div>
    );
  }
}
