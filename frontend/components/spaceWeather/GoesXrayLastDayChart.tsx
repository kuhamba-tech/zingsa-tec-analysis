"use client";

import { useEffect, useMemo, useState } from "react";
import LineChart from "@/components/charts/LineChart";
import SwSectionBanner from "@/components/spaceWeather/SwSectionBanner";
import { getSolarActivity } from "@/lib/api";
import { peekSolarActivity, subscribeSolarActivity } from "@/lib/solarActivityStore";
import type { SolarActivityFull } from "@/lib/types";

function displayFlux(flux: number | null | undefined): string | null {
  if (flux == null || !Number.isFinite(flux)) return null;
  return `${flux.toExponential(2)} W/m²`;
}

/**
 * GOES long-band flux for the last ~day (scaled ×10⁻⁷), shown as the
 * companion chart after the logarithmic driver-timeline X-ray panel.
 */
export default function GoesXrayLastDayChart() {
  const [sa, setSa] = useState<SolarActivityFull | null>(() => peekSolarActivity());
  const [loading, setLoading] = useState(!peekSolarActivity());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeSolarActivity((next) => {
      setSa(next);
      setLoading(false);
    });
    let cancelled = false;
    getSolarActivity()
      .then((payload) => {
        if (!cancelled) {
          setSa(payload);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "GOES X-ray feed unavailable");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const xrayScaled = useMemo(() => {
    const raw = sa?.xray_series ?? [];
    return raw.map((v) => parseFloat((v * 1e7).toFixed(3)));
  }, [sa?.xray_series]);

  const labels = useMemo(() => {
    const n = xrayScaled.length;
    return Array.from({ length: n }, (_, i) => {
      const hoursAgo = ((n - 1 - i) * 40) / 60;
      if (i === n - 1) return "now";
      return `-${Math.max(0, Math.round(hoursAgo))}h`;
    });
  }, [xrayScaled.length]);

  const flareRaw = sa?.flare_class?.trim();
  const flareClass =
    loading && !sa
      ? "Loading…"
      : !flareRaw || flareRaw.toUpperCase() === "N/A"
        ? "Unavailable"
        : flareRaw;
  const fluxLabel = displayFlux(sa?.flux);
  const live = xrayScaled.length > 0;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <SwSectionBanner
        icon="☀️"
        title="GOES X-Ray Flux — Last Day"
        as="h3"
        tone={live ? "ok" : loading ? "warn" : "off"}
        meta={
          <span>
            NOAA SWPC GOES · class {flareClass}
            {fluxLabel ? ` · ${fluxLabel}` : ""}
          </span>
        }
      />
      {live ? (
        <>
          <LineChart
            labels={labels}
            datasets={[{ label: "X-Ray Flux (×10⁻⁷ W/m²)", data: xrayScaled, color: "#f97316" }]}
            yLabel="Flux ×10⁻⁷"
            height={150}
          />
          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            0.1–0.8 nm band · Source: NOAA SWPC GOES primary · Current class {flareClass}
            {fluxLabel ? ` · ${fluxLabel}` : ""}
          </div>
        </>
      ) : (
        <div className="banner banner-info" style={{ fontSize: "0.85rem" }} role="status">
          {loading
            ? "Loading GOES X-ray flux…"
            : error || "X-ray flux data unavailable."}
        </div>
      )}
    </div>
  );
}
