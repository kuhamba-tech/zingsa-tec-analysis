"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

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
 */
export default function DeferredMount({
  children,
  fallback = null,
  rootMargin = "240px 0px",
  eager = false,
  className,
  minHeight,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(eager);

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
      { root: null, rootMargin, threshold: 0.01 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [eager, visible, rootMargin]);

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
