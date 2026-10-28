"use client";

import { useEffect, useState } from "react";
import { getTecGradients } from "@/lib/api";
import type { TecGradientMapsResponse } from "@/lib/types";

function mix(t: number, a: [number, number, number], b: [number, number, number]): string {
  const u = Math.max(0, Math.min(1, t));
  const channel = (index: 0 | 1 | 2) => Math.round(a[index] + (b[index] - a[index]) * u);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function spatialColor(value: number, limit: number): string {
  const t = limit <= 0 ? 0 : Math.max(0, Math.min(1, value / limit));
  if (t < 0.5) return mix(t / 0.5, [8, 48, 140], [240, 220, 40]);
  return mix((t - 0.5) / 0.5, [240, 220, 40], [180, 24, 24]);
}

function temporalColor(value: number, limit: number): string {
  const t = limit <= 0 ? 0 : Math.max(-1, Math.min(1, value / limit));
  if (t < 0) return mix(-t, [20, 28, 40], [56, 140, 220]);
  return mix(t, [20, 28, 40], [210, 64, 48]);
}

function formatNumber(value: number | null, digits = 3): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function GradientField({
  title,
  unit,
  grid,
  lat0,
  lon0,
  diverging,
}: {
  title: string;
  unit: string;
  grid: Array<Array<number | null>>;
  lat0: number;
  lon0: number;
  diverging: boolean;
}) {
  const values = grid.flat().filter((cell): cell is number => cell != null && Number.isFinite(cell));
  const nlat = grid.length;
  const nlon = grid[0]?.length ?? 0;
  const limit = diverging
    ? Math.max(...values.map((value) => Math.abs(value)), 0)
    : Math.max(...values, 0);
  const cell = 26;
  const bar = 16;
  const left = 42;
  const top = 8;
  const width = left + nlon * cell + 28 + bar + 46;
  const height = top + nlat * cell + 28;
  const ticks = 4;

  return (
    <figure className="tec-gradient-map">
      <figcaption>
        {title} ({unit})
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}, ${unit}`}>
        {grid.map((row, i) =>
          row.map((value, j) => {
            const y = top + (nlat - 1 - i) * cell;
            const x = left + j * cell;
            return (
              <rect
                key={`${i}-${j}`}
                x={x}
                y={y}
                width={cell}
                height={cell}
                fill={
                  value == null
                    ? "#1e293b"
                    : diverging
                      ? temporalColor(value, limit)
                      : spatialColor(value, limit)
                }
                stroke="#0b1220"
                strokeWidth="0.6"
              >
                {value != null && (
                  <title>
                    {`${lat0 + i}° to ${lat0 + i + 1}°, ${lon0 + j}° to ${lon0 + j + 1}°: ${value.toFixed(4)} ${unit}`}
                  </title>
                )}
              </rect>
            );
          }),
        )}
        {Array.from({ length: nlat + 1 }, (_, i) => (
          <text
            key={`lat-${i}`}
            x={left - 6}
            y={top + (nlat - i) * cell + 4}
            textAnchor="end"
            fill="#cbd5e1"
            fontSize="10"
          >
            {lat0 + i}°
          </text>
        ))}
        {Array.from({ length: nlon + 1 }, (_, j) => (
          <text
            key={`lon-${j}`}
            x={left + j * cell}
            y={top + nlat * cell + 14}
            textAnchor="middle"
            fill="#cbd5e1"
            fontSize="10"
          >
            {lon0 + j}°
          </text>
        ))}
        {Array.from({ length: ticks }, (_, step) => {
          const y = top + nlat * cell - ((step + 1) * nlat * cell) / ticks;
          const mid = diverging
            ? -limit + ((step + 0.5) / ticks) * 2 * limit
            : ((step + 0.5) / ticks) * limit;
          return (
            <rect
              key={`swatch-${step}`}
              x={left + nlon * cell + 18}
              y={y}
              width={bar}
              height={(nlat * cell) / ticks}
              fill={diverging ? temporalColor(mid, limit) : spatialColor(mid, limit)}
            />
          );
        })}
        {Array.from({ length: ticks + 1 }, (_, step) => {
          const fraction = step / ticks;
          const y = top + nlat * cell - fraction * nlat * cell;
          const label = diverging ? -limit + fraction * 2 * limit : fraction * limit;
          return (
            <text key={`tick-${step}`} x={left + nlon * cell + 38} y={y + 3} fill="#cbd5e1" fontSize="10">
              {label.toFixed(limit < 0.01 ? 4 : 3)}
            </text>
          );
        })}
      </svg>
    </figure>
  );
}

export default function TecGradientMaps() {
  const [maps, setMaps] = useState<TecGradientMapsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getTecGradients()
        .then((payload) => {
          if (!cancelled) {
            setMaps(payload);
            setFailed(false);
          }
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };
    load();
    const id = window.setInterval(load, 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <section className="tec-gradient-maps" aria-label="TEC spatial and temporal gradients">
      <h2>TEC spatial and temporal gradients</h2>
      <p>
        ICAO requires both. The spatial map is the Scharr gradient of the 1° median-filtered
        code-TEC grid, in TECU per degree. The temporal map splits that same 15-minute window
        in half: the second map minus the first, divided by 7.5 minutes, in TECU per minute.
        Grey cells have no pierce point within one degree. The temporal colour is drawn only
        where both halves of the window measured that same cell, so a change of satellites
        is not drawn as a TEC change. Live code TEC still carries receiver bias, so a steep
        colour can be a station offset as well as the ionosphere.
      </p>
      {failed && <p>Gradient maps could not be loaded.</p>}
      {!failed && maps == null && <p>Placing pierce points for the Scharr and temporal maps.</p>}
      {maps && !maps.available && <p>{maps.message}</p>}
      {maps?.available && maps.spatial && maps.lat0 != null && maps.lon0 != null && (
        <>
          <div className="tec-gradient-map-row">
            <GradientField
              title={`Spatial gradient · ${maps.window_start.slice(11, 16)}–${maps.window_end.slice(11, 16)} UTC`}
              unit="TECU/deg"
              grid={maps.spatial}
              lat0={maps.lat0}
              lon0={maps.lon0}
              diverging={false}
            />
            {maps.temporal_available && maps.temporal ? (
              <GradientField
                title="Temporal gradient · second half minus first half"
                unit="TECU/min"
                grid={maps.temporal}
                lat0={maps.lat0}
                lon0={maps.lon0}
                diverging
              />
            ) : (
              <p>{maps.temporal_message || "Temporal gradient is omitted for this window."}</p>
            )}
          </div>
          <div className="tec-map-diagnostic-grid">
            <div>
              <span>Spatial max</span>
              <strong>{formatNumber(maps.spatial_max_tecu_per_deg)} TECU/deg</strong>
            </div>
            <div>
              <span>Spatial mean</span>
              <strong>{formatNumber(maps.spatial_mean_tecu_per_deg)} TECU/deg</strong>
            </div>
            <div>
              <span>East-west max</span>
              <strong>{formatNumber(maps.spatial_east_max_tecu_per_deg)} TECU/deg</strong>
            </div>
            <div>
              <span>North-south max</span>
              <strong>{formatNumber(maps.spatial_north_max_tecu_per_deg)} TECU/deg</strong>
            </div>
            <div>
              <span>Temporal range</span>
              <strong>
                {maps.temporal_available
                  ? `${formatNumber(maps.temporal_min_tecu_per_min)} to ${formatNumber(maps.temporal_max_tecu_per_min)} TECU/min`
                  : "Awaiting both halves"}
              </strong>
            </div>
            <div>
              <span>Pierce points</span>
              <strong>{maps.ipp_count}</strong>
              <small>
                {maps.ipp_count_first_half} then {maps.ipp_count_second_half}
              </small>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
