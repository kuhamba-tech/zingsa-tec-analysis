"use client";

import { useEffect } from "react";
import Link from "next/link";

/** Legacy URL — Navigation Weather lives under /space-weather/gnss-intelligence */
export default function GnssIntelligenceRedirectPage() {
  useEffect(() => {
    window.location.replace("/space-weather/gnss-intelligence/");
  }, []);

  return (
    <div className="page" style={{ padding: "2rem 1rem" }}>
      <h1 className="page-title">Redirecting…</h1>
      <p className="page-subtitle">
        Navigation Weather moved. If you are not redirected automatically, open{" "}
        <Link href="/space-weather/gnss-intelligence/">Navigation Weather</Link>.
      </p>
    </div>
  );
}
