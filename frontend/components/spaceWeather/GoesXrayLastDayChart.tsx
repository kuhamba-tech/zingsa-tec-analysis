"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { getSolarActivity } from "@/lib/api";
import { peekSolarActivity, subscribeSolarActivity } from "@/lib/solarActivityStore";
import type { SolarActivityFull } from "@/lib/types";
import { loadGoesSolarXrayCard } from "@/lib/loadGoesSolarXrayCard";

const GoesSolarXrayCard = dynamic(
  () => loadGoesSolarXrayCard().then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="banner banner-info" role="status">
        Loading GOES X-ray chart…
      </div>
    ),
  },
);

/**
 * Compact GOES companion chart (Cause→Effect stack): NOAA-style log dual-band
 * flux with hover tooltips for UTC time, W/m², and flare class.
 */
export default function GoesXrayLastDayChart() {
  const [sa, setSa] = useState<SolarActivityFull | null>(() => peekSolarActivity());
  const [range, setRange] = useState<"6H" | "1D" | "3D" | "7D">("1D");

  useEffect(() => {
    const unsub = subscribeSolarActivity((next) => setSa(next));
    let cancelled = false;
    getSolarActivity()
      .then((payload) => {
        if (!cancelled) setSa(payload);
      })
      .catch(() => {
        /* store/banner elsewhere — card shows unavailable if empty */
      });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return (
    <GoesSolarXrayCard
      title="GOES X-ray flux — companion (NOAA SWPC)"
      timeline={sa?.xray_timeline}
      fallbackSeries={sa?.xray_series}
      fallbackUpdated={sa?.updated}
      xrayRange={range}
      onRangeChange={setRange}
    />
  );
}
