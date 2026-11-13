"use client";
import { createContext, useContext } from "react";
export const ChartDateRangeContext = createContext<{day: string; setDay: (day: string) => void} | null>(null);
export const utcDayBounds = (day: string) => { const min = Date.parse(day + "T00:00:00Z"); return {min, max:min+86_400_000}; };
export function utcDaySampleIndices(day: string, labels: string[], epochs?: (number | null)[], xValues?: number[]): number[] {
  const bounds = day ? utcDayBounds(day) : null;
  return labels.map((_, i) => i).filter(i => {
    if (!bounds) return true;
    const ms = epochs?.[i] ?? (xValues?.[i] != null && xValues[i] > 1e11 ? xValues[i] : /^\d{4}-\d{2}-\d{2}/.test(labels[i]) ? Date.parse(labels[i]) : NaN);
    return Number.isFinite(ms) && ms != null && ms >= bounds.min && ms < bounds.max;
  });
}
export default function ChartDateRange() {
  const selection = useContext(ChartDateRangeContext);
  if (!selection) return null;
  return <div className="chart-date-range" role="group" aria-label="Chart UTC day">
    <label>Choose a UTC day<input type="date" value={selection.day} max={new Date().toISOString().slice(0,10)} onChange={e=>selection.setDay(e.target.value)} /></label>
    <button type="button" className="btn" onClick={()=>selection.setDay("")}>Live window</button>
    <span>Applies to all Live Metric Timelines. Dates outside loaded source coverage remain empty.</span>
  </div>;
}
