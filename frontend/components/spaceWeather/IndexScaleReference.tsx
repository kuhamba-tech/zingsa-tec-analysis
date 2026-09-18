"use client";

import { useState } from "react";
import { DASHBOARD_SCALE_ROWS } from "@/lib/geomagneticScales";
import SwSectionBanner from "./SwSectionBanner";

export default function IndexScaleReference() {
  const [open, setOpen] = useState(false);

  return (
    <div className="card scale-reference">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
        }}
      >
        <SwSectionBanner
          icon="📐"
          title="Index Scale Reference"
          meta={<span>{open ? "Hide ▾" : "Show ▸"} · Kp, Dst, S4, TEC, F10.7, solar wind</span>}
        />
      </button>
      {!open && (
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0.55rem 0 0" }}>
          Click to expand Kp, Dst, S4, TEC, F10.7 and solar-wind colour scales.
        </p>
      )}
      {open &&
        DASHBOARD_SCALE_ROWS.map((row) => (
          <div className="scale-row" key={row.label}>
            <div className="scale-row-label">{row.label}</div>
            <div className="scale-items">
              {row.items.map((item) => (
                <div className="scale-item" key={`${row.label}-${item.range}`}>
                  <div className="scale-range">{item.range}</div>
                  <div className="scale-text">{item.text}</div>
                  <div className="scale-bar" style={{ backgroundColor: item.color }} />
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
