"use client";

import { useEffect, useState } from "react";

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="#168bd2" strokeWidth="1.8" />
      <path d="M12 7v5l3.5 2" fill="none" stroke="#168bd2" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function formatParts(date: Date, timeZone: string) {
  const time = date.toLocaleTimeString("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const dateLabel = date.toLocaleDateString("en-GB", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return { time, dateLabel };
}

function ClockCard({
  label,
  date,
  timeZone,
  className,
}: {
  label: string;
  date: Date;
  timeZone: string;
  className?: string;
}) {
  const { time, dateLabel } = formatParts(date, timeZone);
  return (
    <div className={`dashboard-clock-card${className ? ` ${className}` : ""}`}>
      <div className="dashboard-clock-body">
        <div className="dashboard-clock-label">{label}</div>
        <div className="dashboard-clock-time">{time}</div>
        <div className="dashboard-clock-date">{dateLabel}</div>
      </div>
      <div className="dashboard-clock-icon-wrap">
        <ClockIcon />
      </div>
    </div>
  );
}

function useLiveClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return now;
}

export function DashboardHeaderClocks() {
  const now = useLiveClock();
  if (!now) return null;
  return (
    <div className="dashboard-clocks">
      <ClockCard label="UTC Time" date={now} timeZone="UTC" />
      <ClockCard label="CAT Local Time" date={now} timeZone="Africa/Harare" />
    </div>
  );
}

export function DashboardUtcClock() {
  const now = useLiveClock();
  if (!now) return null;
  return <ClockCard label="UTC Time" date={now} timeZone="UTC" className="dashboard-clock-card-utc" />;
}

export function DashboardCatClock() {
  const now = useLiveClock();
  if (!now) return null;
  return (
    <ClockCard
      label="CAT Local Time"
      date={now}
      timeZone="Africa/Harare"
      className="dashboard-clock-card-local"
    />
  );
}

/** @deprecated Use DashboardUtcClock + DashboardCatClock */
export default function DashboardClocks() {
  const now = useLiveClock();
  if (!now) return null;
  return (
    <div className="dashboard-clocks">
      <ClockCard label="UTC Time" date={now} timeZone="UTC" />
      <ClockCard label="CAT Local Time" date={now} timeZone="Africa/Harare" />
    </div>
  );
}
