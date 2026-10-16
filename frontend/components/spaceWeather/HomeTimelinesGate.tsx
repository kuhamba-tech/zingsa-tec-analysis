"use client";

import { Component, type ComponentType, type ReactNode } from "react";

type State = {
  error: Error | null;
  retry: number;
  CauseEffect: ComponentType<{ variant?: string }> | null;
  LiveMetrics: ComponentType<{ showIntro?: boolean }> | null;
};

function TimelinesLoading(): ReactNode {
  return (
    <div
      data-home-timelines="loading"
      style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
    >
      <div className="banner banner-info" role="status" style={{ margin: "0.75rem 0" }}>
        Loading CORS map…
      </div>
      <div className="banner banner-info" role="status" style={{ margin: "0.75rem 0" }}>
        Loading live Space Weather graphs…
      </div>
    </div>
  );
}

async function loadTimelineModules(): Promise<{
  CauseEffect: ComponentType<{ variant?: string }>;
  LiveMetrics: ComponentType<{ showIntro?: boolean }>;
}> {
  const [{ loadCauseEffectTimelineStack }, liveMod] = await Promise.all([
    import("@/lib/loadCauseEffectTimeline"),
    import("@/components/spaceWeather/LiveMetricTimelines"),
  ]);
  const causeMod = await loadCauseEffectTimelineStack();
  return {
    CauseEffect: causeMod.default as ComponentType<{ variant?: string }>,
    LiveMetrics: liveMod.default as ComponentType<{ showIntro?: boolean }>,
  };
}

/**
 * Home page: same CORS map + Live Metric graphs as Space Weather.
 * Isolates chunk-load failures so a bad dynamic import cannot blank the dashboard.
 *
 * Chart stacks load only after mount — no module-level `next/dynamic({ ssr: false })` —
 * so SSR never emits a LoadableComponent/Suspense tree that disagrees with the client.
 */
export default class HomeTimelinesGate extends Component<object, State> {
  state: State = {
    error: null,
    retry: 0,
    CauseEffect: null,
    LiveMetrics: null,
  };

  private cancelled = false;
  private loadGeneration = 0;

  componentDidMount() {
    this.cancelled = false;
    void this.loadChunks();
  }

  componentWillUnmount() {
    this.cancelled = true;
  }

  private async loadChunks() {
    const generation = ++this.loadGeneration;
    try {
      const mods = await loadTimelineModules();
      if (this.cancelled || generation !== this.loadGeneration) return;
      this.setState({
        error: null,
        CauseEffect: mods.CauseEffect,
        LiveMetrics: mods.LiveMetrics,
      });
    } catch (err) {
      if (this.cancelled || generation !== this.loadGeneration) return;
      this.setState({
        error: err instanceof Error ? err : new Error(String(err)),
        CauseEffect: null,
        LiveMetrics: null,
      });
    }
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
              this.setState((s) => ({
                error: null,
                retry: s.retry + 1,
                CauseEffect: null,
                LiveMetrics: null,
              }));
              void this.loadChunks();
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    const { CauseEffect, LiveMetrics, retry } = this.state;
    if (!CauseEffect || !LiveMetrics) {
      return <TimelinesLoading />;
    }

    return (
      <div
        key={retry}
        data-home-timelines="ready"
        style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
      >
        <CauseEffect variant="overview" />
        <LiveMetrics showIntro />
      </div>
    );
  }
}
