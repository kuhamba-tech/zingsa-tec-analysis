"use client";

import { useState } from "react";
import {
  buildNationalGnssStatusBlock,
  buildNationalGnssStatusData,
  type NationalGnssStatusData,
} from "@/lib/nationalGnssStatus";
import type { ForecastStatus, GnssForecastCity } from "@/lib/gnssWeatherIntelligence";
import type { SpaceWeatherCurrent } from "@/lib/types";

interface NationalGnssStatusCardProps {
  forecasts: GnssForecastCity[];
  tone: ForecastStatus;
  sw: SpaceWeatherCurrent | null;
  updatedLabel?: string | null;
}

function CopyStatusButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <button type="button" className="gnwi-copy-btn" onClick={copy}>
      {copied ? "Copied!" : "Copy status block"}
    </button>
  );
}

function StatusSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="gnss-status-section">
      <h3 className="gnss-status-section-title">{title}</h3>
      {children}
    </div>
  );
}

function CityRow({ emoji, name, value }: { emoji: string; name: string; value: string }) {
  return (
    <div className="gnss-status-city">
      <div className="gnss-status-city-head">
        <span aria-hidden>{emoji}</span>
        <span>{name}</span>
      </div>
      <div className="gnss-status-city-value">{value}</div>
    </div>
  );
}

function ServiceRow({ name, label, color }: { name: string; label: string; color: string }) {
  return (
    <div className="gnss-status-service">
      <span>{name}</span>
      <span className="gnss-status-service-label" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

function StatusBody({ data }: { data: NationalGnssStatusData }) {
  return (
    <>
      <StatusSection title="GNSS Accuracy Today">
        <div className="gnss-status-cities">
          {data.cities.map((city) => (
            <CityRow key={city.name} emoji={city.emoji} name={city.name} value={city.value} />
          ))}
        </div>
      </StatusSection>

      <StatusSection title="Current Space Weather">
        <div className="gnss-status-sw">
          <div>{data.kp}</div>
          <div>{data.stormRisk}</div>
        </div>
      </StatusSection>

      <StatusSection title="National Services">
        <div className="gnss-status-services">
          {data.services.map((service) => (
            <ServiceRow
              key={service.name}
              name={service.name}
              label={service.label}
              color={service.color}
            />
          ))}
        </div>
      </StatusSection>
    </>
  );
}

export default function NationalGnssStatusCard({
  forecasts,
  tone,
  sw,
  updatedLabel,
}: NationalGnssStatusCardProps) {
  if (forecasts.length === 0) return null;

  const data = buildNationalGnssStatusData(forecasts, tone, sw);
  const copyText = buildNationalGnssStatusBlock(forecasts, tone, sw);

  return (
    <article className="card gnss-status-card">
      <div className="gnss-status-header">
        <h2 className="gnss-status-title">{data.title}</h2>
        {updatedLabel && <span className="gnss-status-updated">Live · {updatedLabel}</span>}
      </div>
      <StatusBody data={data} />
      <div className="gnss-status-actions">
        <CopyStatusButton text={copyText} />
      </div>
    </article>
  );
}
