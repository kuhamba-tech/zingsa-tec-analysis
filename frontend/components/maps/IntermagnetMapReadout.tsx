"use client";

import { useEffect, useState } from "react";
import { getIntermagnetLatest } from "@/lib/api";
import type { IntermagnetLatestObservatory, IntermagnetLatestResponse } from "@/lib/types";

const REFRESH_MS = 10 * 60_000;

function ageLabel(minutes: number): string {
  if (minutes < 90) return `${Math.round(minutes)} min old`;
  if (minutes < 48 * 60) return `${(minutes / 60).toFixed(1)} h old`;
  const days = minutes / 1440;
  return `${days >= 10 ? Math.round(days) : days.toFixed(1)} days old`;
}

function stampLabel(iso: string): string {
  const stamp = new Date(iso);
  if (Number.isNaN(stamp.getTime())) return iso;
  const day = stamp.getUTCDate();
  const month = stamp.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const year = stamp.getUTCFullYear();
  const hh = String(stamp.getUTCHours()).padStart(2, "0");
  const mm = String(stamp.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} ${hh}:${mm} UTC`;
}

function shortName(name: string): string {
  return name.split(",")[0] || name;
}

function ObservatoryLine({ row }: { row: IntermagnetLatestObservatory }) {
  if (row.h_nt == null || row.time == null) {
    return (
      <div>
        {shortName(row.name)} · no public minute
      </div>
    );
  }
  const rate = row.dhdt_nt_per_min;
  const rateText = rate == null ? "" : ` · dH/dt ${rate > 0 ? "+" : ""}${rate.toFixed(2)}`;
  return (
    <div>
      {shortName(row.name)} · H {row.h_nt.toFixed(1)} nT{rateText}
    </div>
  );
}

export default function IntermagnetMapReadout() {
  const [payload, setPayload] = useState<IntermagnetLatestResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getIntermagnetLatest()
        .then((next) => {
          if (!cancelled) setPayload(next);
        })
        .catch(() => {
          if (!cancelled) setPayload(null);
        });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const rows = payload?.observatories ?? [];
  const timed = rows.filter((row) => row.time && row.age_minutes != null);
  const freshest = timed.reduce<IntermagnetLatestObservatory | null>((best, row) => {
    if (!best || (row.age_minutes ?? Infinity) < (best.age_minutes ?? Infinity)) return row;
    return best;
  }, null);
  const nearRealTime = freshest?.status === "near-real-time";

  return (
    <div
      title={payload?.note || "INTERMAGNET minute values from Hermanus and Hartebeesthoek"}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: "0.16rem",
        background: "rgba(0,0,0,0.82)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        padding: "0.4rem 0.65rem",
        fontSize: "0.7rem",
        fontWeight: 700,
        alignSelf: "flex-start",
        maxWidth: "250px",
        lineHeight: 1.25,
      }}
    >
      <div
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--text-muted)",
          fontSize: "0.66rem",
        }}
      >
        INTERMAGNET · South Africa
      </div>
      <div style={{ color: nearRealTime ? "#a78bfa" : "#e9d5ff", fontSize: "0.66rem" }}>
        {nearRealTime ? "Near-real-time minute" : "Latest public minute"}
      </div>
      {rows.length === 0 && (
        <div style={{ fontWeight: 500 }}>Waiting for the public GIN</div>
      )}
      {rows.map((row) => (
        <ObservatoryLine key={row.code} row={row} />
      ))}
      {freshest?.time && freshest.age_minutes != null && (
        <div style={{ fontWeight: 600, fontSize: "0.64rem" }}>
          {stampLabel(freshest.time)} · {ageLabel(freshest.age_minutes)}
        </div>
      )}
    </div>
  );
}
