"use client";

import { useEffect, useState } from "react";
import { getSolarDisk, type SolarDiskResponse } from "@/lib/api";

export default function VisibleSolarDisk({ embedded = false }: { embedded?: boolean }) {
  const [disk, setDisk] = useState<SolarDiskResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getSolarDisk()
        .then((payload) => {
          if (!cancelled) {
            setDisk(payload);
            setFailed(false);
          }
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };
    load();
    const timer = window.setInterval(load, 3 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const count = disk?.active_region_count;
  const sunspots = disk?.sunspot_number;
  const regions = (disk?.regions ?? []).filter(
    (region) => region.label_x != null && region.label_y != null,
  );

  return (
    <section className={embedded ? undefined : "card"} aria-label="Visible solar disk" style={embedded ? { marginTop: "0.9rem" } : undefined}>
      <div className="metric-label" style={{ marginBottom: "0.55rem" }}>
        Visible solar disk
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", marginBottom: "0.7rem" }}>
        <Stat label="Active regions" value={count == null ? "—" : String(count)} />
        <Stat label="Sunspot number" value={sunspots == null ? "—" : String(sunspots)} />
      </div>
      <div
        style={{
          position: "relative",
          width: "min(100%, 520px)",
          aspectRatio: "1",
          background: "#000",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      >
        {disk?.image_url && (
          <img
            key={disk.image_url}
            src={disk.image_url}
            alt="Latest SDO HMI visible continuum of the Sun, with NOAA active-region numbers"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        )}
        {regions.map((region) => (
          <span
            key={region.number}
            style={{
              position: "absolute",
              left: `${(region.label_x ?? 0) * 100}%`,
              top: `${(region.label_y ?? 0) * 100}%`,
              transform: "translate(-50%, -50%)",
              color: "#ffffff",
              fontSize: "0.78rem",
              fontWeight: 700,
              textShadow: "0 0 4px #000, 0 0 2px #000",
              pointerEvents: "none",
            }}
          >
            {region.number}
          </span>
        ))}
      </div>
      <p className="sw-supporting-text" style={{ margin: "0.55rem 0 0" }}>
        {failed
          ? "The NOAA region summary could not be loaded. The disk image is the latest SDO/HMI continuum."
          : disk == null
            ? "Loading the visible disk and the NOAA region summary."
            : disk.mode !== "live"
              ? disk.error ?? "The NOAA region summary could not be loaded."
              : `Latest SDO/HMI continuum${disk.image_time ? `, ${disk.image_time}` : ""}. NOAA numbers regions on the Earth-facing disk. ${count ?? 0} spotted region${count === 1 ? "" : "s"} on the disk. Sunspot number is 10 × groups + spots from that summary${disk.issued ? `. Summary issued ${disk.issued}` : ""}.`}
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
      <span style={{ fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {label}
      </span>
      <span
        style={{
          background: "#15803d",
          color: "#ffffff",
          fontWeight: 700,
          minWidth: "2rem",
          textAlign: "center",
          borderRadius: "3px",
          padding: "0.12rem 0.45rem",
        }}
      >
        {value}
      </span>
    </div>
  );
}
