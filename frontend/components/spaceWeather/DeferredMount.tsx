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
  className,
  minHeight,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(eager);
  const [margin, setMargin] = useState(rootMargin ?? "120px 0px");

  useEffect(() => {
    if (rootMargin) {
      setMargin(rootMargin);
      return;
    }
    const profile = getLoadProfile();
    setMargin(profile.lightPayload ? "40px 0px" : "140px 0px");
  }, [rootMargin]);

  useEffect(() => {
    if (eager || visible) return;
    const node = ref.current;
    if (!node) return;

    // Prefer IntersectionObserver; fall back to a short idle delay.
    if (typeof IntersectionObserver === "undefined") {
      const id = window.setTimeout(() => setVisible(true), 400);
      return () => window.clearTimeout(id);
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { root: null, rootMargin: margin, threshold: 0.01 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [eager, visible, margin]);

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
