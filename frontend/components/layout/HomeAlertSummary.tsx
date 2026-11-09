"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getEarlyWarningSnapshot } from "@/lib/api";
import type { EarlyWarningSnapshot } from "@/lib/earlyWarningTypes";

function tone(severity: string): string {
  if (severity === "severe") return "banner-alert";
  if (severity === "warning" || severity === "watch") return "banner-warn";
  if (severity === "advisory") return "banner-info";
  return "banner-info";
}

/** Compact National Dashboard summary — details live on /storm-watch/. */
export default function HomeAlertSummary() {
  const [snapshot, setSnapshot] = useState<EarlyWarningSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEarlyWarningSnapshot(48, false)
      .then((payload) => {
        if (!cancelled) setSnapshot(payload);
      })
      .catch(() => {
        if (!cancelled) setSnapshot(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = snapshot?.summary;
  const count = summary?.active_count ?? 0;
  const severity = summary?.highest_severity ?? "none";
  const label =
    count > 0
      ? `${count} active alert${count === 1 ? "" : "s"} · highest severity ${severity}`
      : "No active space-weather alerts";

  return (
    <section className="home-storm-alerts" aria-label="Space weather alert summary">
      <Link
        href="/storm-watch/"
        className={`banner ${tone(severity)} home-storm-alert`}
        style={{ textDecoration: "none", display: "block" }}
      >
        <span className="home-storm-alert-label">Alerts</span>
        <span className="home-storm-alert-msg">{label}</span>
      </Link>
      <p className="home-storm-alert-foot">
        <Link href="/storm-watch/">Open Alerts Centre</Link>
      </p>
    </section>
  );
}
