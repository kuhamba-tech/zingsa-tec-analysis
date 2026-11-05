"use client";

import { useEffect, useRef, useState } from "react";
import { GradientHybridMap } from "@/components/maps/TecGradientMaps";
import { getIonoVtecPair, peekIonoVtecPair } from "@/lib/api";
import { tecScaleFromVtec } from "@/lib/spaceWeatherMetrics";
import type { IonoVtecField, IonoVtecPairResponse } from "@/lib/types";

const EMPTY_GRID: Array<Array<number | null>> = [];

function scaleOf(pair: IonoVtecPairResponse | null): number {
  const values = [pair?.morning?.max_tecu, pair?.noon?.max_tecu, pair?.night?.max_tecu, pair?.current?.max_tecu].filter(
    (value): value is number => value != null && Number.isFinite(value) && value > 0,
  );
  return values.length ? Math.max(...values) : 0;
}

function TecMap({
  field,
  fallbackTitle,
  scaleMax,
  waiting,
  prefix,
}: {
  field: IonoVtecField | undefined;
  fallbackTitle: string;
  scaleMax: number;
  waiting: boolean;
  prefix?: boolean;
}) {
  const ready = Boolean(field?.available && field.lat0 != null && field.lon0 != null && field.grid.length);
  const title = ready && field ? (prefix ? `${fallbackTitle} · ${field.label}` : field.label) : fallbackTitle;
  return (
    <GradientHybridMap
      title={title}
      unit="TECU"
      grid={ready && field ? field.grid : EMPTY_GRID}
      lat0={field?.lat0 ?? -23}
      lon0={field?.lon0 ?? 25}
      diverging={false}
      scaleMax={ready ? scaleMax : null}
      emptyMessage={
        waiting
          ? "Loading the measured TEC map…"
          : field?.message || "No measured TEC in this 15-minute window."
      }
    />
  );
}

function tecu(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toFixed(1);
}

function utcStamp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(trimmed)) {
    return `${trimmed.slice(0, 10)} ${trimmed.slice(11, 16)} UTC`;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return trimmed;
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day} ${hour}:${minute} UTC`;
}

function fieldSentence(name: string, field: IonoVtecField | undefined): string {
  if (!field) return `${name} has no measured grid yet.`;
  const low = tecu(field.min_tecu);
  const high = tecu(field.max_tecu);
  const mean = tecu(field.mean_tecu);
  if (!field.available || low == null || high == null || mean == null) {
    return `${name}${field.label ? ` (${field.label})` : ""}: ${field.message || "no measured grid in this 15-minute window."}`;
  }
  return `${name} (${field.label}) runs from ${low} to ${high} TECU, mean ${mean} TECU, from ${field.pierce_points} pierce points.`;
}

export function zimbabweIonoMeasuredText(
  vtec: number | null,
  updatedUtc: string | null,
  pair: IonoVtecPairResponse | null,
  failed: boolean,
): string {
  const when = utcStamp(updatedUtc);
  const measured = vtec != null && Number.isFinite(vtec) ? vtec : null;
  const level = measured == null ? null : tecScaleFromVtec(measured);
  const head = measured == null || level == null
    ? "Live network VTEC is unavailable."
    : `Network VTEC is ${measured.toFixed(1)} TECU${when ? ` at ${when}` : ""}. The magnitude band is ${level.title}, ${level.range} TECU.`;
  if (failed) {
    return `${head} The yesterday and current map grids could not be loaded from the TEC database.`;
  }
  if (!pair) {
    return `${head} Yesterday night, morning, and noon map statistics are still being calculated from the pierce points.`;
  }
  const note = pair.message && !pair.available ? ` ${pair.message}` : "";
  return `${head} ${fieldSentence("Yesterday night", pair.night)} ${fieldSentence("Yesterday morning", pair.morning)} ${fieldSentence("Yesterday noon", pair.noon)} ${fieldSentence("The current window", pair.current)}${note} One TECU is 10¹⁶ electrons per square metre. ΔTEC and ROTI stay unpublished until a quiet-day reference is validated.`;
}

export default function ZimbabweIonoTecMaps({
  onPair,
}: {
  onPair?: (pair: IonoVtecPairResponse | null, failed: boolean) => void;
}) {
  const [pair, setPair] = useState<IonoVtecPairResponse | null>(() => peekIonoVtecPair());
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const onPairRef = useRef(onPair);
  onPairRef.current = onPair;

  useEffect(() => {
    onPairRef.current?.(pair, failed);
  }, [pair, failed]);

  useEffect(() => {
    let cancelled = false;
    const cached = peekIonoVtecPair();
    if (cached) setPair(cached);
    setFailed(false);
    getIonoVtecPair(retry > 0)
      .then((payload) => {
        if (cancelled) return;
        setPair(payload);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [retry]);

  const waiting = !failed && pair == null;
  const scale = scaleOf(pair);

  return (
    <section className="tec-gradient-maps" aria-label="Yesterday night, morning, and noon TEC">
      <h2>Yesterday night, morning, and noon</h2>
      <p>
        Times follow Matamba and Danskin (2022): the nighttime map ends at 01:45 UT
        (03:30–03:45 CAT), morning is the middle of their 07:00–11:00 UT morning
        (08:45–09:00 UT, 10:45–11:00 CAT), and the daytime map ends at 10:40 UT
        (12:25–12:40 CAT). If that window has fewer than 8 pierce points, the
        daytime map uses the next measured 15 minutes on the same day. Each map
        uses 15 minutes of code TEC. Filled
        colours are median vertical TEC in TECU on a 1° grid inside the red Zimbabwe
        boundary. The three maps share one colour maximum. The current window is
        shown under them. Elevation is at least 30°.
      </p>
      {failed && (
        <p role="status">
          The TEC maps could not be loaded. The TEC database may be temporarily unavailable.
          {" "}
          <button className="btn" type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry TEC maps
          </button>
        </p>
      )}
      {waiting && <p>Placing pierce points for yesterday night, morning, and noon.</p>}
      {pair && !pair.available && pair.message && <p role="status">{pair.message}</p>}
      <div className="tec-gradient-map-row tec-gradient-map-row-wide">
        <TecMap
          field={pair?.night}
          fallbackTitle="Yesterday night"
          scaleMax={scale}
          waiting={waiting}
        />
        <TecMap
          field={pair?.morning}
          fallbackTitle="Yesterday morning"
          scaleMax={scale}
          waiting={waiting}
        />
        <TecMap
          field={pair?.noon}
          fallbackTitle="Yesterday noon"
          scaleMax={scale}
          waiting={waiting}
        />
      </div>
      <div className="tec-gradient-map-row tec-gradient-map-row-single">
        <TecMap
          field={pair?.current}
          fallbackTitle="Current TEC"
          scaleMax={scale}
          waiting={waiting}
          prefix
        />
      </div>
    </section>
  );
}
