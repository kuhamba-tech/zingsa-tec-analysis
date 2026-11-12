"use client";

import { useEffect, useMemo, useState } from "react";
import { getSolarBrief, type SolarBriefResponse, type SolarMonitorRegion } from "@/lib/api";
import styles from "./ActiveRegionInspector.module.css";

const CLASSES = [
  { id: "alpha", label: "Alpha", color: "#22c55e" },
  { id: "beta", label: "Beta", color: "#22d3ee" },
  { id: "gamma", label: "Gamma", color: "#f5d90a" },
  { id: "delta", label: "Delta", color: "#fb7185" },
] as const;

function classText(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function complexityCode(value: string | null | undefined): string {
  const text = classText(value);
  let code = "";
  if (text.includes("beta")) code += "B";
  if (text.includes("gamma")) code += "G";
  if (text.includes("delta")) code += "D";
  if (!code && text.includes("alpha")) code = "A";
  return code;
}

function heliographicLocation(latitude: string, longitude: string): string | null {
  const lat = latitude.trim().match(/^(\d+)\s*([NS])$/i);
  const lon = longitude.trim().match(/^(\d+)\s*([EW])$/i);
  if (lat && lon) {
    return `${lat[2].toUpperCase()}${lat[1].padStart(2, "0")}${lon[2].toUpperCase()}${lon[1].padStart(2, "0")}`;
  }
  const raw = [latitude, longitude].map((part) => part.trim()).filter((part) => part && part !== "—");
  return raw.length ? raw.join(" ") : null;
}

function flarePotential(magnetic: string | null | undefined): string | null {
  const text = classText(magnetic);
  if (!text) return null;
  if (text.includes("delta")) return "High flare potential";
  if (text.includes("gamma")) return "Moderate flare potential";
  if (text.includes("beta")) return "Low flare potential";
  if (text.includes("alpha")) return "Quiet flare potential";
  return null;
}

function earthFacingSpots(brief: SolarBriefResponse | null): SolarMonitorRegion[] {
  return (brief?.monitor_regions ?? []).filter((region) => {
    if (region.kind !== "spot") return false;
    return Math.abs(region.central_meridian_deg) < 90;
  });
}

export default function ActiveRegionInspector() {
  const [brief, setBrief] = useState<SolarBriefResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSolarBrief()
      .then((payload) => {
        if (!cancelled) setBrief(payload);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const regions = useMemo(() => earthFacingSpots(brief), [brief]);
  const counts = useMemo(() => {
    const tally = { alpha: 0, beta: 0, gamma: 0, delta: 0 };
    for (const region of regions) {
      const text = classText(region.magnetic_class);
      if (text.includes("alpha")) tally.alpha += 1;
      if (text.includes("beta")) tally.beta += 1;
      if (text.includes("gamma")) tally.gamma += 1;
      if (text.includes("delta")) tally.delta += 1;
    }
    return tally;
  }, [regions]);
  const chosen = regions.find((region) => region.number === selected) ?? null;
  const chosenLocation = chosen ? heliographicLocation(chosen.latitude, chosen.longitude) : null;
  const chosenPotential = chosen ? flarePotential(chosen.magnetic_class) : null;
  const loading = !brief && !failed;

  return (
    <section className={styles.panel} aria-label="Active region and sunspot inspector">
      <h2 className={styles.title}>Active Region &amp; Sunspot Inspector</h2>
      <h3 className={styles.section}>Magnetic complexity</h3>
      <div className={styles.complexity}>
        {CLASSES.map((item) => (
          <div className={styles.complexCell} key={item.id}>
            <div className={styles.complexLabel}>{item.label}</div>
            <div className={styles.complexValue} style={{ color: item.color }}>
              {loading ? "…" : counts[item.id]}
            </div>
          </div>
        ))}
      </div>
      <h3 className={styles.section}>Select an Earth-facing active region</h3>
      {loading ? <p className={styles.note}>Updating the NOAA region summary…</p> : null}
      {!loading && regions.length === 0 ? (
        <p className={styles.note}>Earth-facing sunspot regions are unavailable in the latest NOAA summary.</p>
      ) : null}
      {regions.length > 0 ? (
        <div className={styles.regions} role="list">
          {regions.map((region) => {
            const active = region.number === selected;
            const code = complexityCode(region.magnetic_class);
            return (
              <button
                key={region.number}
                type="button"
                role="listitem"
                className={`${styles.region}${active ? ` ${styles.regionOn}` : ""}`}
                aria-pressed={active}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelected((current) => (current === region.number ? null : region.number));
                }}
              >
                <span>AR {region.number}</span>
                {code ? <span className={styles.code}>{code}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {chosen ? (
        <div className={styles.selected}>
          <div className={styles.section}>Selected region</div>
          <div className={styles.selectedNumber}>AR {chosen.number}</div>
          {chosenPotential ? <div className={styles.potential}>{chosenPotential}</div> : null}
          <div className={styles.field}>
            <div className={styles.fieldLabel}>Heliographic location</div>
            <div className={styles.fieldValue}>{chosenLocation ?? "Unavailable"}</div>
          </div>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>Magnetic classification</div>
            <div className={styles.fieldValue}>{complexityCode(chosen.magnetic_class) || chosen.magnetic_class || "Unavailable"}</div>
          </div>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>Visible spots</div>
            <div className={styles.fieldValue}>{chosen.spot_count != null ? chosen.spot_count : "Unavailable"}</div>
          </div>
          <p className={styles.report}>
            {chosenLocation
              ? `NOAA reports this Earth-facing region at ${chosenLocation}.`
              : "NOAA reports this Earth-facing region. The heliographic location is unavailable."}
            {chosen.flare_today ? ` Flare today ${chosen.flare_today}.` : ""}
          </p>
        </div>
      ) : null}
    </section>
  );
}
