"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { getLoadProfile } from "@/lib/loadBudget";

type Props = {
  children: ReactNode;
  /** Placeholder while off-screen / not yet mounted. */
  fallback?: ReactNode;
  /** Root margin so we start loading slightly before the section enters view. */
  rootMargin?: string;
  /** Force mount immediately (e.g. desktop opt-out). Default: defer. */
  eager?: boolean;
  /** Extra wait after the section is eligible — keeps first paint free of heavy API work. */
  minDelayMs?: number;
  className?: string;
  minHeight?: number | string;
};

/**
 * Mobile-first: keep heavy below-fold UI out of the first paint until the
 * section is near the viewport. Desktop can pass eager when desired.
 * On constrained / Save-Data clients the preload margin is tighter so charts
 * and OpenLayers do not compete with Live Metric fetches.
 */
export default function DeferredMount({
  children,
  fallback = null,
  rootMargin,
  eager = false,
  minDelayMs = 0,
  className,
  minHeight,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(eager && minDelayMs <= 0);
  const [margin, setMargin] = useState(rootMargin ?? "120px 0px");

  useEffect(() => {
    if (rootMargin) {
      setMargin(rootMargin);
      return;
    }
    const profile = getLoadProfile();
    // Tighter preload on phones so OpenLayers / Chart.js stay off the critical path.
    setMargin(profile.slowNetwork ? "0px 0px" : profile.lightPayload ? "24px 0px" : "120px 0px");
  }, [rootMargin]);

  useEffect(() => {
    const profile = getLoadProfile();
    // Never eager-mount heavy blocks on mobile / Save-Data — first paint stays metric cards.
    const allowEager = eager && minDelayMs <= 0 && !profile.lightPayload;
    if (allowEager) {
      setVisible(true);
      return;
    }
    if (visible) return;
    const node = ref.current;
    if (!node) return;

    let cancelled = false;
    let delayHandle: number | null = null;
    let io: IntersectionObserver | null = null;
    const delayFloor = profile.lightPayload
      ? Math.max(minDelayMs, Math.floor(profile.heavyMountDelayMs * 0.5))
      : minDelayMs;

    const arm = () => {
      if (cancelled) return;
      if (delayFloor > 0) {
        delayHandle = window.setTimeout(() => {
          if (!cancelled) setVisible(true);
        }, delayFloor) as unknown as number;
      } else {
        setVisible(true);
      }
    };

    // Prefer IntersectionObserver; fall back to a short idle delay.
    if (typeof IntersectionObserver === "undefined") {
      const id = window.setTimeout(arm, profile.lightPayload ? 800 : 400);
      return () => {
        cancelled = true;
        window.clearTimeout(id);
        if (delayHandle != null) window.clearTimeout(delayHandle);
      };
    }

    io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io?.disconnect();
          arm();
        }
      },
      { root: null, rootMargin: margin, threshold: 0.01 },
    );
    io.observe(node);
    return () => {
      cancelled = true;
      io?.disconnect();
      if (delayHandle != null) window.clearTimeout(delayHandle);
    };
  }, [eager, visible, margin, minDelayMs]);

  return (
    <div
      ref={ref}
      className={className}
      style={minHeight != null ? { minHeight } : undefined}
    >
      {visible ? children : fallback}
    </div>
  );
}
