"use client";

import { useEffect, useMemo, useState } from "react";
import { getUptimeMonitor, type UptimeMonitorReport } from "@/lib/api";

function cat(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Harare", dateStyle: "medium", timeStyle: "medium" }).format(new Date(value)) : "Awaiting first check";
}

function duration(start: string, end: string | null, now: number) {
  const seconds = Math.max(0, Math.floor(((end ? Date.parse(end) : now) - Date.parse(start)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function eventLabel(eventType: string) {
  return eventType === "DOWN" ? "DOWN" : "UP";
}

export default function UptimeMonitoringPanel({ hours, station }: { hours: number; station: string }) {
  const [report, setReport] = useState<UptimeMonitorReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(0);
  const [filter, setFilter] = useState<"all" | "down" | "recovered">("all");
  useEffect(() => {
    let cancelled = false;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await getUptimeMonitor(hours, station || undefined);
        if (!cancelled) { setReport(next); setFailed(false); }
      } catch { if (!cancelled) setFailed(true); }
      finally { busy = false; }
    };
    void refresh();
    setNow(Date.now());
    const poll = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { cancelled = true; window.clearInterval(poll); window.clearInterval(clock); };
  }, [hours, station]);
  const healthy = !failed && report?.status === "monitoring";
  const events = useMemo(() => {
    const rows = report?.events ?? [];
    if (filter === "down") return rows.filter((event) => event.event_type === "DOWN");
    if (filter === "recovered") return rows.filter((event) => Boolean(event.ended_at));
    return rows;
  }, [filter, report?.events]);
  const activeIncidents = (report?.events ?? []).filter((event) => !event.ended_at).length;
  const resolved = (report?.events ?? []).filter((event) => event.ended_at);
  const meanRepair = resolved.length
    ? resolved.reduce((sum, event) => sum + (Date.parse(event.ended_at!) - Date.parse(event.started_at)), 0) / resolved.length / 60000
    : null;

  return <section className="card uptime-monitor-panel" aria-labelledby="recent-station-events">
    <div className="uptime-monitor-heading">
      <div>
        <h3 id="recent-station-events">Recent Station Events</h3>
        <p>Confirmed transitions from the monitoring database. Initially offline stations establish a baseline and do not create DOWN events.</p>
      </div>
      <span className={`uptime-health-badge${healthy ? " is-healthy" : ""}`} role="status">
        {failed ? "Monitor unavailable" : !report ? "Checking monitor..." : healthy ? `Monitoring active · ${report.tracked} stations` : report.status === "stopped" ? "Monitoring worker stopped" : "Communication problem"}
      </span>
    </div>
    <div className="uptime-kpi-grid">
      <div className="uptime-kpi"><span>Active incidents</span><strong className={activeIncidents ? "is-danger" : "is-good"}>{activeIncidents}</strong><small>Confirmed and unresolved</small></div>
      <div className="uptime-kpi"><span>Mean time to repair</span><strong>{meanRepair == null ? "—" : duration("1970-01-01T00:00:00Z", new Date(meanRepair * 60000).toISOString(), 0)}</strong><small>Resolved incidents</small></div>
      <div className="uptime-kpi"><span>Monitoring health</span><strong className={healthy ? "is-good" : "is-warning"}>{healthy ? "Operational" : "Check status"}</strong><small>Last check: {cat(report?.checked_at ?? null)}</small></div>
    </div>
    {report?.error && <p className="banner banner-warn" role="alert">{report.error}</p>}
    <div className="uptime-event-toolbar" role="tablist" aria-label="Station event filter">
      {(["all", "down", "recovered"] as const).map((value) => <button key={value} type="button" className={`home-map-layer-btn${filter === value ? " is-active" : ""}`} onClick={() => setFilter(value)} role="tab" aria-selected={filter === value}>{value === "all" ? "All events" : value === "down" ? "Down" : "Recovered"}</button>)}
    </div>
    <div className="uptime-events-table-wrap"><table className="uptime-events-table">
      <thead><tr>{["Station", "Event / time (CAT)", "Outage duration", "Incident"].map(label => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{events.map(event => <tr key={event.id}>
        <td><strong>{event.station_code.toUpperCase()}</strong><small>{event.station_name}</small></td>
        <td><span className={`uptime-event-pill ${event.event_type === "DOWN" ? "is-down" : "is-up"}`}>{eventLabel(event.event_type)}</span><small>{cat(event.time)}</small></td>
        <td>{duration(event.started_at, event.ended_at, now)}</td>
        <td><span className={`uptime-incident-state ${event.ended_at ? "is-resolved" : "is-open"}`}>{event.ended_at ? "Resolved" : "Open"}</span></td>
      </tr>)}</tbody>
    </table></div>
    {report && !events.length && <p className="uptime-empty-state">No events match this filter in the selected period.</p>}
  </section>;
}
