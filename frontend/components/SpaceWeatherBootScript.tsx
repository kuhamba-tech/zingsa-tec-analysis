"use client";

/**
 * Early boot fetch for National Dashboard metrics.
 * Server HTML uses text/javascript so the browser runs it during parse.
 * On client hydration, type flips to text/plain so React does not warn that
 * scripts inside components never execute (they already ran on first paint).
 * See Next.js “Preventing Flash Before Hydration” InlineScript pattern.
 */
export default function SpaceWeatherBootScript({ html }: { html: string }) {
  return (
    <script
      id="zgiis-sw-boot"
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
