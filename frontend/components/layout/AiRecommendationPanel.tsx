"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import NavigationNewsBulletinHeader from "@/components/layout/NavigationNewsBulletinHeader";
import {
  formatIndicesUpdatedLabel,
  formatPowerIndicesDetail,
  formatTelecomIndicesDetail,
} from "@/lib/spaceWeatherMetrics";
import {
  buildNavigationNewsSync,
  hasIndicesForNews,
} from "@/lib/navigationNewsFromIndices";
import type { AiAudienceRecommendation } from "@/lib/aiRecommendations";
import {
  getAudienceNationalServiceStatus,
  nationalServiceStatusColor,
} from "@/lib/nationalGnssStatus";
import type { NoaaKpForecastRow } from "@/lib/gnssAvailabilityForecast";
import { fetchNoaaKpForecast } from "@/lib/gnssAvailabilityForecast";
import type { GnssAvailabilityForecast } from "@/lib/gnssAvailabilityForecast";
import type { ForecastStatus } from "@/lib/gnssWeatherIntelligence";
import { getGicStatus, getStations } from "@/lib/api";
import type { GicStatusResponse, SpaceWeatherCurrent, Station } from "@/lib/types";

const TONE_COLOR: Record<ForecastStatus, string> = {
  excellent: "#00ff88",
  moderate: "#eab308",
  warning: "#ef4444",
};

interface AiRecommendationPanelProps {
  sw?: SpaceWeatherCurrent | null;
  stations?: Station[] | null;
  indicesLoading?: boolean;
}

function RecommendationCard({
  rec,
  sw,
  tone,
}: {
  rec: AiAudienceRecommendation;
  sw: SpaceWeatherCurrent | null;
  tone: ForecastStatus;
}) {
  const detail =
    rec.id === "power"
      ? formatPowerIndicesDetail(sw)
      : rec.id === "telecom"
        ? formatTelecomIndicesDetail(sw)
        : rec.detail;

  const serviceStatus = getAudienceNationalServiceStatus(rec.id, tone, rec.tone);

  return (
    <article className="ai-rec-card" style={{ borderColor: TONE_COLOR[rec.tone] }}>
      <div className="ai-rec-card-head">
        <span className="ai-rec-icon" aria-hidden>
          {rec.icon}
        </span>
        <h3 className="ai-rec-label">{rec.label}</h3>
      </div>
      <p className="ai-rec-headline">{rec.headline}</p>
      {detail && <p className="ai-rec-detail">{detail}</p>}
      {serviceStatus && (
        <div className="ai-rec-service">
          <span
            className="ai-rec-service-label"
            style={{
              color: nationalServiceStatusColor(
                serviceStatus.statusLabel,
                serviceStatus.effectiveTone,
              ),
            }}
          >
            {serviceStatus.statusLabel}
          </span>
        </div>
      )}
    </article>
  );
}

function GnssAvailabilityBlock({ forecast }: { forecast: GnssAvailabilityForecast | null }) {
  if (!forecast || forecast.periods.length === 0) return null;
  return (
    <div className="ai-rec-availability">
      <div className="ai-rec-avail-head">
        <span className="ai-rec-avail-kicker">{forecast.subtitle}</span>
        <span className="ai-rec-avail-title">{forecast.title}</span>
      </div>
      <div className="ai-rec-avail-periods">
        {forecast.periods.map((period) => (
          <div key={period.label} className="ai-rec-avail-period">
            <span className="ai-rec-avail-label">{period.label}</span>
            <span className="ai-rec-avail-stars" aria-label={`${period.stars} out of 5 stars`}>
              {period.starsDisplay}
            </span>
          </div>
        ))}
      </div>
      {forecast.stormAlert && <p className="ai-rec-avail-alert">{forecast.stormAlert}</p>}
    </div>
  );
}

const PLACEHOLDER_RECS: AiAudienceRecommendation[] = [
  { id: "surveyors", label: "Surveyors", icon: "📐", headline: "…", tone: "excellent" },
  { id: "farmers", label: "Farmers", icon: "🌾", headline: "…", tone: "excellent" },
  { id: "pilots", label: "Pilots", icon: "✈️", headline: "…", tone: "excellent" },
  { id: "power", label: "Power Utilities", icon: "⚡", headline: "…", tone: "excellent" },
  { id: "telecom", label: "Telecommunications", icon: "📡", headline: "…", tone: "excellent" },
];

export default function AiRecommendationPanel({
  sw = null,
  stations = null,
  indicesLoading = false,
}: AiRecommendationPanelProps) {
  const [gic, setGic] = useState<GicStatusResponse | null>(null);
  const [kpRows, setKpRows] = useState<NoaaKpForecastRow[]>([]);
  const [resolvedStations, setResolvedStations] = useState<Station[]>(stations ?? []);
  const [supplementLoading, setSupplementLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchGen = useRef(0);

  const swKey = sw?.updated_utc ?? "";

  useEffect(() => {
    if (stations != null) {
      setResolvedStations(stations);
    }
  }, [stations]);

  useEffect(() => {
    if (indicesLoading || !hasIndicesForNews(sw)) {
      return;
    }

    const generation = ++fetchGen.current;
    setSupplementLoading(true);
    setError(null);

    (async () => {
      try {
        const [stationsData, gicData, kpForecast] = await Promise.all([
          stations != null
            ? Promise.resolve(stations)
            : getStations(true).catch(() => [] as Station[]),
          getGicStatus().catch(() => null as GicStatusResponse | null),
          fetchNoaaKpForecast(),
        ]);

        if (generation !== fetchGen.current) return;

        if (stations == null) setResolvedStations(stationsData);
        setGic(gicData);
        setKpRows(kpForecast);
      } catch (e) {
        if (generation !== fetchGen.current) return;
        setError(e instanceof Error ? e.message : "Could not build recommendations");
      } finally {
        if (generation === fetchGen.current) setSupplementLoading(false);
      }
    })();
  }, [swKey, stations, indicesLoading, sw]);

  const newsBundle = useMemo(() => {
    if (!sw || !hasIndicesForNews(sw)) return null;
    return buildNavigationNewsSync(sw, resolvedStations, gic, kpRows);
  }, [sw, resolvedStations, gic, kpRows]);

  const recommendations = newsBundle?.recommendations ?? [];
  const availability = newsBundle?.availability ?? null;
  const tone = newsBundle?.tone ?? "excellent";
  const updatedLabel = formatIndicesUpdatedLabel(sw);

  const showPreparing =
    indicesLoading || (supplementLoading && recommendations.length === 0);
  const displayRecs = showPreparing ? PLACEHOLDER_RECS : recommendations;

  return (
    <section
      id="navigation-news"
      className="ai-rec-panel nav-news-bulletin"
      aria-label="ZINGSA Navigation News"
    >
      <NavigationNewsBulletinHeader
        updatedLabel={updatedLabel}
        showUpdated={!showPreparing && !!updatedLabel}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
      />

      {!collapsed && (
        <>
          {error && !indicesLoading && (
            <div className="banner banner-warn ai-rec-banner">{error}</div>
          )}
          {showPreparing && (
            <div className="banner banner-info ai-rec-banner">
              {indicesLoading
                ? "Loading live indices…"
                : "Preparing today\u2019s Navigation News from live Kp, Dst, S4, and CORS data…"}
            </div>
          )}
          <GnssAvailabilityBlock forecast={availability} />
          <div className="ai-rec-grid">
            {displayRecs.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} sw={sw} tone={tone} />
            ))}
          </div>
          {!showPreparing && recommendations.length > 0 && (
            <p className="ai-rec-footnote">
              National outlook:{" "}
              <strong style={{ color: TONE_COLOR[tone] }}>
                {tone === "excellent" ? "Low risk" : tone === "moderate" ? "Moderate" : "Alert"}
              </strong>
              {" · "}
              Derived from live Kp, Dst, S4, CORS feed health, and GIC monitors — not synthetic placeholders.
            </p>
          )}
        </>
      )}
    </section>
  );
}
