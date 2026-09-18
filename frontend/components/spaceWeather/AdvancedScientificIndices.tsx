"use client";

import { useState } from "react";
import type { SolarActivityFull, SpaceWeatherCurrent } from "@/lib/types";
import { buildAdvancedIndexRows } from "@/lib/spaceWeatherMetrics";
import SwSectionBanner from "./SwSectionBanner";

interface Props {
  sw: SpaceWeatherCurrent | null;
  solar?: SolarActivityFull | null;
}

/**
 * Research indices moved out of the primary Sun→Zimbabwe card row (Ap, F10.7, Bt, density, …).
 * Underlying APIs are unchanged — values are never invented.
 */
export default function AdvancedScientificIndices({ sw, solar = null }: Props) {
  const [open, setOpen] = useState(false);
  const rows = buildAdvancedIndexRows(sw, solar);

  return (
    <div
      className="card"
      style={{
        padding: "0.75rem 1rem",
        border: "1px solid var(--border)",
        background: "#0a1929",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          color: "#fff",
          cursor: "pointer",
          padding: 0,
          textAlign: "left",
        }}
      >
        <SwSectionBanner
          icon="🔬"
          title="Advanced scientific indices"
          meta={
            <span>
              {open ? "Hide ▾" : "Show ▸"} · Ap, F10.7, Kp, IMF Bt, density / temperature
            </span>
          }
        />
      </button>
      {!open && (
        <p style={{ fontSize: "0.68rem", color: "var(--text-muted)", margin: "0.45rem 0 0" }}>
          Research context for the primary Sun→Zimbabwe chain — values are never invented.
        </p>
      )}
      {open && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(9.5rem, 1fr))",
            gap: "0.55rem",
            marginTop: "0.75rem",
          }}
        >
          {rows.map((row) => (
            <div
              key={row.key}
              style={{
                background: "rgba(15, 40, 70, 0.55)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "0.55rem 0.7rem",
              }}
            >
              <div
                style={{
                  fontSize: "0.62rem",
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  marginBottom: 4,
                }}
              >
                {row.label}
              </div>
              <div style={{ fontWeight: 800, fontSize: "1.05rem", color: row.valueColor }}>
                {row.value}
              </div>
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: 2 }}>
                {row.note}
              </div>
            </div>
          ))}
          <div
            style={{
              gridColumn: "1 / -1",
              fontSize: "0.65rem",
              color: "var(--text-muted)",
              lineHeight: 1.45,
            }}
          >
            ΔTEC and ROTI structures will appear here once a validated quiet-time reference and sampling
            window exist. Values are never fabricated.
          </div>
        </div>
      )}
    </div>
  );
}
