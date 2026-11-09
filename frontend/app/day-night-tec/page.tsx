"use client";

import { useEffect, useState, type CSSProperties } from "react";
import LineChart from "@/components/charts/LineChart";
import { getDayNightTec } from "@/lib/api";
import type { DayNightSeries, DayNightTec } from "@/lib/dayNightTec";
import coverageStyles from "./DayNightCoverage.module.css";

const REGION_COLOR: Record<keyof DayNightSeries, string> = {
  network: "#e2e8f0",
  northern: "#38bdf8",
  central: "#4ade80",
  southern: "#fb923c",
};

const DAY_COLORS = ["#64748b", "#38bdf8", "#22d3ee", "#a3e635", "#facc15", "#fb923c", "#f472b6"];

function regionLines(series: DayNightSeries, dashed = false) {
  return (Object.keys(REGION_COLOR) as (keyof DayNightSeries)[]).map((region) => ({
    label: region === "network" ? "All stations" : region[0].toUpperCase() + region.slice(1),
    data: series[region],
    color: REGION_COLOR[region],
    dashed,
    spanGaps: false as const,
    tension: 0,
  }));
}

export default function DayNightTecPage() {
  const [data, setData] = useState<DayNightTec | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDayNightTec()
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((exc: unknown) => {
        if (!cancelled) setError(exc instanceof Error ? exc.message : "Could not load day–night TEC");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const coverage = data?.coverage;
  return (
    <div>
      <h1 className="page-title">Daily Day–Night TEC</h1>
      <p className="page-subtitle">
        Measured GOPI code TEC from the Zimbabwe CORS archive. Day {data?.day_hours ?? "06:00–18:00 CAT"},
        night {data?.night_hours ?? "18:00–06:00 CAT"}. Regions: North &gt; −18.2°, Central −20.2° to −18.2°,
        South ≤ −20.2°.
      </p>

      {error && <div className="banner banner-alert">{error}</div>}
      {!data && !error && <div className="banner banner-info">Loading measured TEC…</div>}
      {data && !data.available && (
        <div className="banner banner-warn">{data.message ?? "No measured GOPI observations in this window."}</div>
      )}

      {data?.available && coverage && (
        <>
          <section className={`card ${coverageStyles.card}`} aria-label="Dataset coverage">
            <header className={coverageStyles.header}>
              <div>
                <p className={coverageStyles.eyebrow}>Dataset coverage</p>
                <h2 className={coverageStyles.title}>Measured GOPI code TEC</h2>
              </div>
              <p className={coverageStyles.period}>
                {coverage.first ?? "—"} → {coverage.last ?? "—"} CAT
              </p>
            </header>

            <div className={coverageStyles.stats}>
              <CoverageStat
                label="Samples"
                value={coverage.observations.toLocaleString()}
                hint="Measured observations"
                accent="#38bdf8"
              />
              <CoverageStat
                label="Stations"
                value={String(coverage.station_count)}
                hint="CORS sites reporting"
                accent="#4ade80"
              />
              <CoverageStat
                label="Above 50 TECU"
                value={coverage.observations_above_50.toLocaleString()}
                hint="Retained in these graphs"
                accent="#fbbf24"
              />
              <CoverageStat
                label="Elevation mask"
                value={`≥ ${data.elevation_min_deg}°`}
                hint="Lower elevations excluded"
                accent="#fb923c"
              />
            </div>

            <div className={coverageStyles.rules} aria-label="Processing rules">
              <span className={coverageStyles.chip}>
                <strong>VTEC</strong> {data.vtec_rule.replace(/\.$/, "")}
              </span>
              <span className={coverageStyles.chip}>
                <strong>Day</strong> {data.day_hours}
              </span>
              <span className={coverageStyles.chip}>
                <strong>Night</strong> {data.night_hours}
              </span>
              <span className={coverageStyles.chip}>
                <strong>Threshold</strong> Values above 50 TECU kept
              </span>
            </div>

            <details className={coverageStyles.details}>
              <summary>Method, exclusions and source</summary>
              <div className={coverageStyles.detailsBody}>
                <p className={coverageStyles.method}>{data.weighting}</p>
                <ul className={coverageStyles.excludeList}>
                  {data.excluded.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className={coverageStyles.source}>Source · {data.source}</p>
              </div>
            </details>
          </section>

          <section className="card" style={{ marginTop: 16 }}>
            <h2>24-hour profile — {data.today} CAT</h2>
            <LineChart
              preserveSamples
              labels={data.labels_24h}
              datasets={regionLines(data.profile_24h)}
              yLabel="VTEC (TECU)"
              height={320}
            />
          </section>

          <section className="card" style={{ marginTop: 16 }}>
            <h2>Daytime — {data.yesterday} and {data.today}</h2>
            <p className="small-note">Hours 06–17 CAT. Yesterday is dashed.</p>
            <LineChart
              preserveSamples
              labels={data.labels_day}
              datasets={[
                ...regionLines(data.daytime.yesterday, true).map((row) => ({ ...row, label: `${row.label} ${data.yesterday}` })),
                ...regionLines(data.daytime.today).map((row) => ({ ...row, label: `${row.label} ${data.today}`, borderDash: undefined, dashed: false })),
              ]}
              yLabel="VTEC (TECU)"
              height={320}
            />
          </section>

          <section className="card" style={{ marginTop: 16 }}>
            <h2>Nighttime — {data.nighttime.previous_night.evening_date} and {data.nighttime.last_night.evening_date}</h2>
            <p className="small-note">
              Each curve runs 18:00 CAT through 06:00 CAT the next morning. Last night starts {data.nighttime.last_night.evening_date} and ends {data.nighttime.last_night.morning_date}. The earlier night is dashed.
            </p>
            <LineChart
              preserveSamples
              labels={data.labels_night}
              datasets={[
                ...regionLines(data.nighttime.previous_night.series, true).map((row) => ({
                  ...row,
                  label: `${row.label} night of ${data.nighttime.previous_night.evening_date}`,
                  dashed: true,
                })),
                ...regionLines(data.nighttime.last_night.series).map((row) => ({
                  ...row,
                  label: `${row.label} night of ${data.nighttime.last_night.evening_date}`,
                  dashed: false,
                })),
              ]}
              yLabel="VTEC (TECU)"
              height={320}
            />
          </section>

          <section className="card" style={{ marginTop: 16 }}>
            <h2>Seven-day overlay</h2>
            <p className="small-note">One line per civil day, all stations, hour of day in CAT. A break is a missing hour.</p>
            <LineChart
              preserveSamples
              labels={data.labels_24h}
              datasets={data.seven_day.map((day, index) => ({
                label: day.date,
                data: day.network,
                color: DAY_COLORS[index % DAY_COLORS.length],
                spanGaps: false as const,
                tension: 0,
              }))}
              yLabel="VTEC (TECU)"
              height={320}
            />
          </section>

          <section className="card" style={{ marginTop: 16 }}>
            <h2>Regional day and night</h2>
            <p className="small-note">
              Each point is the mean of the occupied day hours, or of the occupied night hours, on that civil date. Night hours here are 00:00–06:00 and 18:00–24:00 on the same date.
            </p>
            <LineChart
              preserveSamples
              labels={[...new Set(data.regional_comparison.map((row) => row.date))]}
              datasets={(["northern", "central", "southern"] as const).flatMap((region) => {
                const rows = data.regional_comparison.filter((row) => row.region === region);
                return [
                  {
                    label: `${region} day`,
                    data: rows.map((row) => row.day_mean),
                    color: REGION_COLOR[region],
                    spanGaps: false as const,
                    tension: 0,
                  },
                  {
                    label: `${region} night`,
                    data: rows.map((row) => row.night_mean),
                    color: REGION_COLOR[region],
                    dashed: true,
                    spanGaps: false as const,
                    tension: 0,
                  },
                ];
              })}
              yLabel="VTEC (TECU)"
              height={320}
            />
          </section>
        </>
      )}
    </div>
  );
}

function CoverageStat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent: string;
}) {
  return (
    <div
      className={coverageStyles.stat}
      style={{ ["--stat-accent" as string]: accent } as CSSProperties}
    >
      <span className={coverageStyles.statLabel}>{label}</span>
      <strong className={coverageStyles.statValue}>{value}</strong>
      <span className={coverageStyles.statHint}>{hint}</span>
    </div>
  );
}
