"use client";

import { useEffect, useState } from "react";
import { subscribeSpaceWeather } from "@/lib/spaceWeatherStore";
import {
  activeBandForRow,
  SIDEBAR_GEOMagnetic_SCALE_ROWS,
  type ScaleRow,
} from "@/lib/geomagneticScales";
import type { SpaceWeatherCurrent } from "@/lib/types";

function ScaleStrip({
  row,
  activeIndex,
  liveLabel,
}: {
  row: ScaleRow;
  activeIndex: number;
  liveLabel?: string | null;
}) {
  return (
    <div className={`sidebar-scale-row sidebar-scale-row--${row.id}`}>
      <div className="sidebar-scale-head">
        <span className="sidebar-scale-label">{row.label}</span>
        {liveLabel && <span className="sidebar-scale-live">{liveLabel}</span>}
      </div>
      <div className="sidebar-scale-items" role="list" aria-label={row.label}>
        {row.items.map((item, index) => {
          const active = index === activeIndex;
          return (
            <div
              key={`${row.id}-${item.range}`}
              className={`sidebar-scale-chip${active ? " is-active" : ""}`}
              role="listitem"
              title={`${item.range}: ${item.text}`}
            >
              <span className="sidebar-scale-chip-bar" style={{ backgroundColor: item.color }} />
              <span className="sidebar-scale-chip-text">{item.range}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SidebarGeomagneticScales() {
  const [sw, setSw] = useState<SpaceWeatherCurrent | null>(null);

  useEffect(() => subscribeSpaceWeather(setSw), []);

  const values = { kp: sw?.kp, dst: sw?.dst, ap: null };

  return (
    <section className="sidebar-geomagnetic-scales" aria-label="Geomagnetic index scales">
      <div className="sidebar-scales-title">Index Scales</div>
      {SIDEBAR_GEOMagnetic_SCALE_ROWS.map((row) => {
        const activeIndex = activeBandForRow(row.id, values);
        let liveLabel: string | null = null;
        if (row.id === "kp" && sw?.kp != null) liveLabel = `Kp ${sw.kp.toFixed(1)}`;
        if (row.id === "dst" && sw?.dst != null) liveLabel = `Dst ${sw.dst.toFixed(0)} nT`;
        return (
          <ScaleStrip key={row.id} row={row} activeIndex={activeIndex} liveLabel={liveLabel} />
        );
      })}
    </section>
  );
}
