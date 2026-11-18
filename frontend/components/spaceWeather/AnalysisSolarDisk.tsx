"use client";

import { useEffect, useState } from "react";
import { getSolarArchiveDay, type SolarArchiveDay } from "@/lib/api";
import { startVisiblePolling } from "@/lib/visiblePolling";

type FlarePeak = { x: number; label: string };
type ArchiveFrame = SolarArchiveDay["frames"][number];
type FlareRegion = SolarArchiveDay["flare_regions"][number];
const MAX_FRAME_OFFSET_MS = 25 * 60_000;

function utcLabel(time: string) {
  return new Date(time).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function nearestFrame(frames: ArchiveFrame[] | undefined, time: number) {
  let frame: ArchiveFrame | undefined;
  let offset = MAX_FRAME_OFFSET_MS + 1;
  for (const candidate of frames ?? []) {
    const distance = Math.abs(Date.parse(candidate.time) - time);
    if (distance < offset) {
      offset = distance;
      frame = candidate;
    }
  }
  return frame;
}

function SolarArchivePanel({ channel, frame, regions, flare, status }: {
  channel: 131 | 193;
  frame?: ArchiveFrame;
  regions?: SolarArchiveDay["regions"];
  flare?: FlareRegion | null;
  status: string;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const showImage = frame && failedImage !== frame.url;
  const frameHours = frame ? (Date.parse(frame.time) - Date.parse(frame.time.slice(0, 10))) / 3600_000 : 0;
  const activeRegions = (regions ?? []).flatMap(region => {
    const longitude = region.central_meridian_deg + frameHours * (13.2 / 24);
    if (Math.abs(longitude) >= 90) return [];
    const lat = region.latitude_deg * Math.PI / 180;
    const cmd = longitude * Math.PI / 180;
    return [{ number: region.number, x: .5 + .465 * Math.cos(lat) * Math.sin(cmd), y: .5 - .465 * Math.sin(lat) }];
  });
  const source = channel === 193 ? activeRegions.find(region => region.number === flare?.region) : flare;
  const size = channel === 193 ? 1024 : 512;

  return <figure style={{ margin: 0, minWidth: 0, maxWidth: 530 }}>
    <div style={{ position: "relative", aspectRatio: "1", background: "#080e18", display: "grid", placeItems: "center" }}>
      {showImage ? <>
        {/* eslint-disable-next-line @next/next/no-img-element -- SDO serves timestamped archive JPEGs. */}
        <img key={frame.url} src={frame.url} alt={`SDO AIA ${channel} Å solar disk recorded ${utcLabel(frame.time)}`}
          width={size} height={size} decoding="async" onError={() => setFailedImage(frame.url)}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
        {channel === 193 && <svg viewBox="0 0 100 100" aria-hidden="true"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          <g fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth=".24">
            <circle cx="50" cy="50" r="46.5" />
            <ellipse cx="50" cy="50" rx="23.25" ry="46.5" />
            <path d="M50 3.5V96.5 M3.5 50H96.5 M9.73 26.75H90.27 M9.73 73.25H90.27 M26.75 9.73H73.25 M26.75 90.27H73.25" />
          </g>
          {activeRegions.filter(region => region.number !== flare?.region).map(region =>
            <text key={region.number} x={Math.min(94, Math.max(6, region.x * 100))}
              y={Math.min(97, Math.max(4, region.y * 100 - 2))}
              fill="#e0f2fe" stroke="#082f49" strokeWidth=".55" paintOrder="stroke"
              fontSize="3" fontWeight="700" textAnchor="middle">{region.number}</text>
          )}
        </svg>}
        {flare && source?.x != null && source.y != null && <>
          <span aria-hidden="true" style={{
            position: "absolute", left: `${source.x * 100}%`, top: `${source.y * 100}%`,
            transform: "translate(-50%, -50%)", width: 22, height: 22, borderRadius: "50%",
            border: "2px solid #fda4af", boxShadow: "0 0 0 1px #000", pointerEvents: "none",
          }} />
          <span style={{
            position: "absolute", left: `${Math.min(82, Math.max(18, source.x * 100))}%`,
            top: `${Math.min(94, source.y * 100 + 5)}%`, transform: "translateX(-50%)",
            background: "#080e18", color: "#fda4af", padding: "2px 5px",
            borderRadius: 4, fontSize: ".72rem", fontWeight: 700, whiteSpace: "nowrap",
          }}>{flare.flare_class} · AR {flare.region}</span>
        </>}
      </> : <p role="status" style={{ padding: "1rem", textAlign: "center" }}>
        {frame ? "The SDO image could not be downloaded." : status}
      </p>}
    </div>
    <figcaption style={{ marginTop: ".45rem", fontSize: ".8rem" }}>
      AIA {channel} Å · {showImage ? utcLabel(frame.time) : "Frame unavailable"}
    </figcaption>
  </figure>;
}

export default function AnalysisSolarDisk({ time, peaks, selectedFlare, onPick, onArchive }: {
  time: number;
  peaks: FlarePeak[];
  selectedFlare: FlarePeak | null;
  onPick: (time: number) => void;
  onArchive: (result: { day: string; data: SolarArchiveDay }) => void;
}) {
  const day = new Date(time).toISOString().slice(0, 10);
  const [result, setResult] = useState<{ day: string; data: SolarArchiveDay | null } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    let complete = false;
    const load = () => getSolarArchiveDay(day).then(
      data => {
        if (!active) return;
        if (complete && data.edited_report_available === false) return;
        complete = data.edited_report_available !== false;
        setResult({ day, data });
        onArchive({ day, data });
      },
      () => { if (active) setResult(current => current?.day === day && current.data ? current : { day, data: null }); },
    );
    const today = new Date().toISOString().slice(0, 10);
    const stopPolling = startVisiblePolling(async () => {
      if (!complete || day === today) await load();
    }, day === today ? 5 * 60_000 : 30_000);
    return () => { active = false; stopPolling(); };
  }, [day, onArchive, retry]);

  const archive = result?.day === day ? result.data : null;
  const frame131 = nearestFrame(archive?.frames, time);
  const frame193 = nearestFrame(archive?.frames_193, time);
  const status = result?.day !== day ? "Loading the SDO archive for this UTC day…"
    : archive ? "No SDO frame is available within 25 minutes of the selected time."
    : "The SDO archive could not be loaded.";
  const archivedPeaks = (archive?.flare_regions ?? []).filter(report => /^[MX]/i.test(report.flare_class)).map(report => ({
    x: Date.parse(report.time), label: report.flare_class,
  }));
  const buttons = [...peaks, ...archivedPeaks.filter(peak => !peaks.some(other =>
    other.label === peak.label && Math.abs(other.x - peak.x) <= 2 * 60_000,
  ))].sort((a, b) => a.x - b.x);
  const activeFlare = selectedFlare ?? archivedPeaks.reduce<FlarePeak | null>((closest, peak) => {
    const offset = Math.abs(peak.x - time);
    if (offset > 5 * 60_000) return closest;
    return !closest || offset < Math.abs(closest.x - time) ? peak : closest;
  }, null);
  const region = activeFlare && archive?.flare_regions.find(report =>
    report.flare_class === activeFlare.label && Math.abs(Date.parse(report.time) - activeFlare.x) <= 2 * 60_000,
  );

  return (
    <section className="card" aria-label="Archived SDO solar disk" style={{ margin: "0 0 1rem", minWidth: 0 }}>
      <strong>NASA SDO solar disk</strong>
      <p style={{ fontSize: ".85rem", margin: ".35rem 0" }}>Selected {utcLabel(new Date(time).toISOString())}</p>
      {buttons.length > 0 && (
        <div role="group" aria-label="Jump to an M- or X-class flare peak" style={{ display: "flex", flexWrap: "wrap", gap: ".4rem", margin: ".6rem 0" }}>
          {buttons.map(peak => (
            <button key={`${peak.x}:${peak.label}`} type="button" className="btn"
              aria-pressed={activeFlare?.x === peak.x && activeFlare.label === peak.label}
              onClick={() => onPick(peak.x)}>
              {peak.label} · {utcLabel(new Date(peak.x).toISOString())}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 530px))", gap: "1rem", marginTop: ".65rem" }}>
        <SolarArchivePanel channel={131} frame={frame131} flare={region} status={status} />
        <SolarArchivePanel channel={193} frame={frame193} regions={archive?.regions} flare={region} status={status} />
      </div>
      <p style={{ fontSize: ".8rem", margin: ".45rem 0" }}>
        {activeFlare && (region?.region
          ? `${activeFlare.label} · NOAA AR ${region.region}. Disk markers show approximate active-region locations. `
          : `${activeFlare.label} · Cataloged source region unavailable. `)}
        <a href="https://sdo.gsfc.nasa.gov/data/aiahmi/" target="_blank" rel="noreferrer">NASA SDO archive</a>
      </p>
      {result?.day === day && !archive && (
        <button type="button" className="btn" onClick={() => { setResult(null); setRetry(attempt => attempt + 1); }}>Retry SDO archive</button>
      )}
    </section>
  );
}
