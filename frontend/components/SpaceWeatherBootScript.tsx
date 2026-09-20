"use client";

/**
 * Loads /zgiis-sw-boot.js during SSR HTML parse (before layout.js).
 * On the client, type flips to text/plain so React does not warn about
 * script tags inside components (the file already ran on first paint).
 */
export default function SpaceWeatherBootScript() {
  return (
    <script
      id="zgiis-sw-boot"
      src={typeof window === "undefined" ? "/zgiis-sw-boot.js" : undefined}
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
    />
  );
}
