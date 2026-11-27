import { ImageResponse } from "next/og";
import type { HeliosphericMonitorResponse } from "./types";

const HOUR = 3_600_000;
const LEFT = 55;
const RIGHT = 1060;
const TOP = 28;
const BASE = 318;
const PLOT_TOP = 122;
const KP_SERIES = [
  { key: "observed", label: "Observed", color: "#34d399" },
  { key: "estimated", label: "Estimated", color: "#fbbf24" },
  { key: "predicted", label: "Predicted", color: "#38bdf8" },
] as const;

export function kpAdvisoryImage({ kp, dst }: HeliosphericMonitorResponse) {
  // Archived forecasts can overlap later estimates and observations of the same bin.
  const byTime = new Map<number, { time: number; value: number; color: string }>();
  for (const { key, color } of KP_SERIES) {
    kp[key].forEach((value, index) => {
      const time = kp.epoch_ms?.[index] ?? Date.parse(kp.times[index]);
      if (value !== null && Number.isFinite(time) && value >= 0 && value <= 9 && !byTime.has(time)) {
        byTime.set(time, { time, value, color });
      }
    });
  }
  const samples = [...byTime.values()];
  if (!samples.length) return null;

  const latest = Math.max(...samples.map(({ time }) => time));
  const bars = samples.filter(({ time }) => time >= latest - 5 * 24 * HOUR);
  const start = Math.min(...bars.map(({ time }) => time)) - 1.5 * HOUR;
  const end = latest + 1.5 * HOUR;
  const x = (time: number) => LEFT + (RIGHT - LEFT) * (time - start) / (end - start);
  const kpY = (value: number) => BASE - (BASE - TOP) * value / 9;
  const barWidth = Math.min(64, (RIGHT - LEFT) * 2.35 * HOUR / (end - start));
  const dstPoints = (dst?.dst ?? []).flatMap((value, index) => {
    const time = dst?.epoch_ms?.[index] ?? Date.parse(dst?.times[index] ?? "");
    return value !== null && Number.isFinite(value) && time >= start && time <= end
      ? [{ time, value }]
      : [];
  }).sort((a, b) => a.time - b.time);
  const dstMin = Math.floor(Math.min(-50, ...dstPoints.map(({ value }) => value)) / 50) * 50;
  const dstMax = Math.ceil(Math.max(50, ...dstPoints.map(({ value }) => value)) / 50) * 50;
  const dstY = (value: number) => BASE - (BASE - TOP) * (value - dstMin) / (dstMax - dstMin);
  const dstPath = dstPoints.map(({ time, value }, index) => {
    const previous = dstPoints[index - 1];
    const command = previous && time - previous.time <= 1.5 * HOUR ? "L" : "M";
    return `${command}${x(time)},${dstY(value)}`;
  }).join(" ");
  const day = 24 * HOUR;
  const ticks: number[] = [];
  for (let tick = Math.ceil(start / day) * day; tick <= end; tick += day) {
    ticks.push(tick);
  }

  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: 32, background: "#07111c", color: "#e8eef5" }}>
      <div style={{ fontSize: 34, fontWeight: 700 }}>GFZ / NOAA planetary Kp · observed &amp; forecast</div>
      <div style={{ display: "flex", gap: 24, marginTop: 12, fontSize: 20 }}>
        {KP_SERIES.map(({ color, label }) => <span key={label} style={{ color }}>{label}</span>)}
        <span>{dstPoints.length ? "Kyoto Dst (nT, right axis)" : "Kyoto Dst unavailable"}</span>
      </div>
      <svg width="1136" height="368" viewBox="0 0 1136 368" style={{ marginTop: 8 }}>
        {[0, 3, 6, 9].map((level) => (
          <line key={level} x1={LEFT} y1={kpY(level)} x2={RIGHT} y2={kpY(level)} stroke="#34516a" />
        ))}
        {bars.map(({ time, value, color }) => (
          <rect key={`${time}-${color}`} x={x(time) - barWidth / 2} y={Math.min(kpY(value), BASE - 2)} width={barWidth} height={Math.max(2, BASE - kpY(value))} fill={color} />
        ))}
        {dstPoints.length > 0 && <path d={dstPath} fill="none" stroke="#f8fafc" strokeWidth="2.5" />}
        {dstPoints.map(({ time, value }) => <circle key={time} cx={x(time)} cy={dstY(value)} r="1.7" fill="#f8fafc" />)}
      </svg>
      {[0, 3, 6, 9].map((level) => (
        <span key={level} style={{ position: "absolute", left: 62, top: PLOT_TOP + kpY(level) - 10, fontSize: 16 }}>{level}</span>
      ))}
      {dstPoints.length > 0 && [dstMin, 0, dstMax].map((level) => (
        <span key={level} style={{ position: "absolute", left: RIGHT + 43, top: PLOT_TOP + dstY(level) - 10, fontSize: 16 }}>{level}</span>
      ))}
      {ticks.map((time) => (
        <span key={time} style={{ position: "absolute", left: x(time) + 7, top: PLOT_TOP + BASE + 8, fontSize: 16 }}>
          {new Date(time).toISOString().slice(5, 10)}
        </span>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 17, color: "#a3b7ca" }}>
        <span>NOAA SWPC · Time axis UTC</span>
        <span>{new Date(start + 1.5 * HOUR).toISOString().slice(0, 16).replace("T", " ")} to {new Date(end - 1.5 * HOUR).toISOString().slice(0, 16).replace("T", " ")} UTC</span>
      </div>
    </div>,
    { width: 1200, height: 555 },
  );
}
