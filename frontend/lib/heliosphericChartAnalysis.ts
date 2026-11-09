import type { ChartAnalysisBlock } from "./multiSourceChartAnalysis";
import type { HeliosphericMonitorResponse } from "./types";
import {
  CYCLE_25_SCALE,
  FLARE_BEAT,
  HOW_BULLETINS_ARE_WRITTEN,
  ZIMBABWE_TRANSLATION,
} from "./scientistBulletin";

export type HeliosphericPanelId =
  | "overview"
  | "protons"
  | "imf"
  | "solar_wind"
  | "kp";

/** Shared Sun→Earth chain framing for the heliospheric monitor stack. */
export const HELIOSPHERIC_CHAIN_LEAD =
  "Read these panels in bulletin order: GOES X-rays, then protons, then solar wind and Bz at L1, then Kp. That is how a scientist decides whether a Zimbabwe TEC change is a dayside flare, a radiation event, or a storm that arrived later.";

export function analyzeHeliosphericOverview(): ChartAnalysisBlock {
  return {
    lead: HELIOSPHERIC_CHAIN_LEAD,
    bullets: [
      HOW_BULLETINS_ARE_WRITTEN,
      CYCLE_25_SCALE,
      ZIMBABWE_TRANSLATION,
      "Daytime TEC rise over Zimbabwe is often the quiet EUV pattern. A storm-time response needs Bz, solar-wind speed, and Kp or Dst together with the local TEC and S4 traces.",
    ],
  };
}

export function analyzeGoesXrayExplanation(opts?: {
  flareClass?: string;
  sampleCount?: number;
  latest?: number | null;
  peak?: number | null;
}): ChartAnalysisBlock {
  const flareClass = opts?.flareClass ?? "Unavailable";
  const liveBits: string[] = [];
  if (opts?.sampleCount) {
    liveBits.push(`${opts.sampleCount} samples in the displayed window`);
  }
  if (opts?.latest != null && Number.isFinite(opts.latest)) {
    liveBits.push(`latest ${opts.latest.toFixed(3)} ×10⁻⁷ W/m²`);
  }
  if (opts?.peak != null && Number.isFinite(opts.peak)) {
    liveBits.push(`peak ${opts.peak.toFixed(3)} ×10⁻⁷ W/m²`);
  }

  return {
    lead: `GOES soft X-ray flux, 0.1–0.8 nm. Current class on this dashboard: ${flareClass}.`,
    bullets: [
      FLARE_BEAT,
      "Peak flux bands (W/m²): A ≈ 10⁻⁸–10⁻⁷, B ≈ 10⁻⁷–10⁻⁶, C ≈ 10⁻⁶–10⁻⁵, M ≈ 10⁻⁵–10⁻⁴, X ≥ 10⁻⁴. The number after the letter is the multiplier inside that class.",
      "A TEC change near an X-ray spike is a possible association; establish daylight geometry, timing and a local baseline before attribution. Solar-flare and geomagnetic effects are distinct.",
      ...(liveBits.length ? [`In this plot: ${liveBits.join("; ")}.`] : []),
    ],
  };
}

export function analyzeProtonFluxPanel(data: HeliosphericMonitorResponse | null): ChartAnalysisBlock {
  const series = data?.protons.series ?? {};
  const channel10 = series[">=10 MeV"] ?? [];
  const vals = channel10.filter((v): v is number => v != null && Number.isFinite(v));
  const peak10 = vals.length ? Math.max(...vals) : null;
  const latest10 = vals.length ? vals[vals.length - 1] : null;
  const floor10 = vals.length ? Math.min(...vals) : null;
  const quiet = peak10 != null && peak10 < 10;

  return {
    lead: "This graph shows the GOES proton flux at Earth over the last three days. The four lines are the integral channels above 10, 50, 100 and 500 MeV, in particle flux units. Its importance is the radiation and high-frequency radio hazard: a sharp rise is an energetic-particle event. Read it separately from the soft X-ray flare and from the coronal mass ejection that can later change Zimbabwe TEC.",
    bullets: [
      latest10 != null && peak10 != null
        ? `In the ≥10 MeV channel the latest flux is ${latest10.toFixed(2)} pfu and the peak in this window is ${peak10.toFixed(2)} pfu${floor10 != null ? `. The channel stayed between ${floor10.toFixed(2)} and ${peak10.toFixed(2)} pfu` : ""}.`
        : "No ≥10 MeV samples are available in the current NOAA feed window.",
      quiet
        ? "A particle event is a sharp rise above this background. NOAA calls it an S-scale radiation storm only after ≥10 MeV flux reaches 10 pfu. This window does not."
        : "A rise through 10 pfu in the ≥10 MeV channel is the NOAA S1 radiation-storm threshold. Read that scale separately from Kp.",
      "A flare can stay confined, with no ejection, or it can be eruptive and leave with a coronal mass ejection. An ejection can also leave with no visible flare. The ejection carries plasma and magnetic field into the solar wind, from under 200 km/s to above 2,000 km/s, and that is the structure that can later change the ionosphere and GNSS. This proton graph is the energetic-particle result: radiation and HF radio, not the first explanation of a Zimbabwe TEC change.",
    ],
  };
}

function utcStamp(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  const date = new Date(time);
  const day = date.getUTCDate();
  const month = date.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${hour}:${minute} UTC`;
}

function nearestSample(
  times: string[] | undefined,
  values: (number | null)[] | undefined,
  iso: string,
  maxMinutes = 90,
): number | null {
  const target = Date.parse(iso);
  if (!Number.isFinite(target) || !times || !values) return null;
  let best: number | null = null;
  let bestGap = Infinity;
  for (let i = 0; i < times.length; i += 1) {
    const value = values[i];
    const time = Date.parse(times[i] ?? "");
    if (value == null || !Number.isFinite(value) || !Number.isFinite(time)) continue;
    const gap = Math.abs(time - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = value;
    }
  }
  return best != null && bestGap <= maxMinutes * 60_000 ? best : null;
}

export function analyzeImfPanel(data: HeliosphericMonitorResponse | null): ChartAnalysisBlock {
  const times = data?.imf.times ?? [];
  const bz = data?.imf.bz ?? [];
  const bt = data?.imf.bt ?? [];
  const by = data?.imf.by ?? [];
  const points = times
    .map((time, index) => ({ time, bz: bz[index], bt: bt[index], by: by[index] }))
    .filter((point): point is { time: string; bz: number; bt: number | null; by: number | null } =>
      point.bz != null && Number.isFinite(point.bz));
  const speeds = (data?.solar_wind.speed ?? []).filter((value): value is number => value != null && Number.isFinite(value));
  const latestSpeed = speeds.length ? speeds[speeds.length - 1] : null;
  const slowest = speeds.length ? Math.min(...speeds) : null;
  const fastest = speeds.length ? Math.max(...speeds) : null;
  const observedKp = (data?.kp.observed ?? []).filter((value): value is number => value != null && Number.isFinite(value));
  const latestKp = observedKp.length ? observedKp[observedKp.length - 1] : null;
  const peakKp = observedKp.length ? Math.max(...observedKp) : null;
  const dst = (data?.dst?.dst ?? []).filter((value): value is number => value != null && Number.isFinite(value));
  const latestDst = dst.length ? dst[dst.length - 1] : null;

  if (!points.length) {
    return {
      lead: "This graph shows the interplanetary magnetic field just upstream of Earth, at Sun–Earth L1. White is the total strength Bt, blue is the east–west component By, and red is Bz, north positive and south negative. Its importance is coupling: a sustained southward Bz lets the solar wind drive a geomagnetic storm. The trace is read with the solar-wind speed. It is not a Kp or G-scale rating.",
      bullets: ["No IMF Bz samples are available in the current RTSW window."],
    };
  }

  const latest = points[points.length - 1];
  const south = points.reduce((best, point) => (point.bz < best.bz ? point : best), points[0]);
  const speedAtSouth = nearestSample(data?.solar_wind.times, data?.solar_wind.speed, south.time);
  const spanMs = (run: { time: string }[]) =>
    run.length ? Date.parse(run[run.length - 1].time) - Date.parse(run[0].time) : -1;
  let run: typeof points = [];
  let longest: typeof points = [];
  for (const point of points) {
    if (point.bz <= -5) run.push(point);
    else {
      if (spanMs(run) > spanMs(longest)) longest = run;
      run = [];
    }
  }
  if (spanMs(run) > spanMs(longest)) longest = run;
  const runSpeeds = longest.flatMap((point) => {
    const speed = nearestSample(data?.solar_wind.times, data?.solar_wind.speed, point.time, 70);
    return speed == null ? [] : [speed];
  });
  const runSlow = runSpeeds.length ? Math.min(...runSpeeds) : null;
  const runFast = runSpeeds.length ? Math.max(...runSpeeds) : null;
  const storm = (peakKp != null && peakKp >= 5) || (latestDst != null && latestDst <= -50);

  const field = `Most southward Bz is ${south.bz.toFixed(1)} nT at ${utcStamp(south.time)}${speedAtSouth != null ? `, with the solar wind at ${Math.round(speedAtSouth)} km/s` : ""}. Latest Bz is ${latest.bz.toFixed(1)} nT${latest.bt != null ? `, Bt ${latest.bt.toFixed(1)} nT` : ""}${latest.by != null ? `, By ${latest.by.toFixed(1)} nT` : ""}${latestSpeed != null ? `, and the solar wind is ${Math.round(latestSpeed)} km/s` : ""}.`;
  const windowSpeed = slowest != null && fastest != null
    ? ` Across this plot the solar wind stayed between ${Math.round(slowest)} and ${Math.round(fastest)} km/s.`
    : "";
  const interval = longest.length
    ? ` The longest stretch with Bz at or below −5 nT ran from ${utcStamp(longest[0].time)} to ${utcStamp(longest[longest.length - 1].time)}, reaching ${Math.min(...longest.map((point) => point.bz)).toFixed(1)} nT${runSlow != null && runFast != null ? `, while the wind was ${Math.round(runSlow)}–${Math.round(runFast)} km/s` : ""}.`
    : "";
  const indices = `${peakKp != null ? ` Observed Kp peaked at ${peakKp.toFixed(1)}${latestKp != null ? ` and the latest bar is ${latestKp.toFixed(1)}` : ""}.` : ""}${latestDst != null ? ` Latest Dst is ${Math.round(latestDst)} nT.` : ""}`;
  const verdict = storm
    ? " The displayed Kp or Dst values show geomagnetic activity, but do not identify its driver or establish a Zimbabwe GNSS impact. Dst is not a NOAA G level."
    : ` ${peakKp != null ? `The maximum displayed observed Kp is ${peakKp.toFixed(1)}, below the G1 threshold of 5.` : "Observed Kp is unavailable; a G level cannot be assigned."} Neither a single Bz sample nor solar-wind speed alone predicts a storm level.`;


  return {
    lead: "This graph shows the interplanetary magnetic field just upstream of Earth, at Sun–Earth L1. White is the total strength Bt, blue is the east–west component By, and red is Bz, north positive and south negative. Its importance is coupling: a sustained southward Bz lets the solar wind drive a geomagnetic storm. The trace is read with the solar-wind speed. It is not a Kp or G-scale rating.",
    bullets: [
      `${field}${windowSpeed}`,
      `${interval.trim()} ${indices}${verdict}`.trim(),
      "Southward Bz can favour coupling, but the field strength, how long it holds, the solar-wind speed, and the conditions already in the magnetosphere also matter. A sustained interval near −15 nT, with wind above about 500 km/s and high density, is the strong-storm coupling seen in CME magnetic clouds this cycle.",
    ],
  };
}

/** Optional NOAA/SolarHam brief used to name flares, Earth-facing regions and ejections. */
export type SolarWindBriefContext = {
  earth_facing_region_count?: number | null;
  spotted_region_count?: number | null;
  c_percent?: number | null;
  m_percent?: number | null;
  x_percent?: number | null;
  flares_today?: { label: string; c_count: number; m_count: number; x_count: number } | null;
  flares_yesterday?: { label: string; c_count: number; m_count: number; x_count: number } | null;
  earth_directed_cme?: boolean | null;
  coronal_hole_stream?: boolean | null;
  stream_polarity?: string | null;
  storm_window?: string | null;
  expected_kp?: number | null;
  expected_kp_scale?: string | null;
  expected_kp_window?: string | null;
  regions?: { number: number; c_percent: number; m_percent: number; x_percent: number }[];
  monitor_regions?: {
    number: number;
    limb: boolean;
    flare_today: string | null;
    flare_yesterday: string | null;
    magnetic_class: string | null;
  }[];
} | null;

function flareDaySentence(
  label: string,
  day: { label: string; c_count: number; m_count: number; x_count: number } | null | undefined,
): string | null {
  if (!day) return null;
  const bits = [
    day.c_count > 0 ? `${day.c_count} C-class` : null,
    day.m_count > 0 ? `${day.m_count} M-class` : null,
    day.x_count > 0 ? `${day.x_count} X-class` : null,
  ].filter(Boolean);
  if (!bits.length) {
    return `${label}: ${day.label}. No C-, M- or X-class flares are counted in that GOES summary.`;
  }
  return `${label}: ${day.label} — ${bits.join(", ")}.`;
}

function earthFacingActivitySentence(brief: SolarWindBriefContext): string {
  if (!brief) {
    return "Earth-facing sunspot / flare catalogue is unavailable in this sample — C/M/X classes and eruption status are not invented.";
  }

  const facing = brief.earth_facing_region_count ?? brief.spotted_region_count;
  const parts: string[] = [];
  if (facing == null) {
    parts.push("Earth-facing region count is unavailable.");
  } else {
    parts.push(
      `${facing} Earth-facing sunspot region${facing === 1 ? "" : "s"} ${facing === 1 ? "is" : "are"} reported on the NOAA disk summary.`,
    );
  }

  const chanceBits = [
    brief.c_percent != null ? `C-class ${brief.c_percent}%` : null,
    brief.m_percent != null ? `M-class ${brief.m_percent}%` : null,
    brief.x_percent != null ? `X-class ${brief.x_percent}%` : null,
  ].filter(Boolean);
  if (chanceBits.length) {
    parts.push(
      `NOAA whole-disk flare probabilities for the forecast day: ${chanceBits.join(", ")}. Those are chances of C-, M- or X-class flares erupting, not a guarantee of an Earth-directed ejection.`,
    );
  }

  const today = flareDaySentence("GOES flares today", brief.flares_today);
  const yesterday = flareDaySentence("GOES flares yesterday", brief.flares_yesterday);
  if (today) parts.push(today);
  if (yesterday) parts.push(yesterday);

  const monitors = brief.monitor_regions ?? [];
  const earthFacingMonitors = monitors.filter((region) => !region.limb);
  const limbMonitors = monitors.filter((region) => region.limb);
  if (earthFacingMonitors.length) {
    const named = earthFacingMonitors
      .map((region) => {
        const flare =
          region.flare_today
            ? ` flared ${region.flare_today} today`
            : region.flare_yesterday
              ? ` flared ${region.flare_yesterday} yesterday`
              : " has no listed C/M/X flare in the monitor summary";
        const mag = region.magnetic_class ? ` (${region.magnetic_class})` : "";
        return `Region ${region.number}${mag}${flare}`;
      })
      .slice(0, 6);
    parts.push(
      `Earth-facing active regions on the monitor: ${named.join("; ")}${
        earthFacingMonitors.length > 6 ? `; +${earthFacingMonitors.length - 6} more` : ""
      }.`,
    );
  }
  if (limbMonitors.length) {
    parts.push(
      `${limbMonitors.length} region${limbMonitors.length === 1 ? "" : "s"} sit at the limb and are not treated as Earth-facing centers.`,
    );
  }

  const highM = (brief.regions ?? []).filter((region) => region.m_percent >= 30);
  const highX = (brief.regions ?? []).filter((region) => region.x_percent >= 10);
  if (highM.length || highX.length) {
    const mText = highM.length
      ? highM.map((region) => `${region.number} (M ${region.m_percent}%)`).join(", ")
      : null;
    const xText = highX.length
      ? highX.map((region) => `${region.number} (X ${region.x_percent}%)`).join(", ")
      : null;
    parts.push(
      [
        mText ? `Elevated M-class probability on region(s) ${mText}` : null,
        xText ? `elevated X-class probability on region(s) ${xText}` : null,
      ]
        .filter(Boolean)
        .join("; ") + ".",
    );
  }

  if (brief.earth_directed_cme === true) {
    parts.push(
      "NOAA's coronagraph assessment reports an Earth-directed coronal mass ejection — plasma has left the Sun toward Earth.",
    );
  } else if (brief.earth_directed_cme === false) {
    parts.push("NOAA's coronagraph assessment reports no Earth-directed coronal mass ejection in the current check.");
  } else {
    parts.push("Earth-directed CME status is unavailable from the current brief.");
  }

  if (brief.coronal_hole_stream) {
    const polarity = brief.stream_polarity ? `${brief.stream_polarity}-polarity ` : "";
    const window = brief.storm_window ? ` Arrival / storm window: ${brief.storm_window}.` : "";
    parts.push(`A ${polarity}coronal-hole high-speed stream is in the NOAA forecast.${window}`);
  }

  if (brief.expected_kp != null) {
    const scale = brief.expected_kp_scale ? ` (${brief.expected_kp_scale})` : "";
    const window = brief.expected_kp_window ? ` for ${brief.expected_kp_window}` : "";
    parts.push(`Greatest expected 3-hour Kp${window}: ${brief.expected_kp}${scale}.`);
  }

  return parts.join(" ");
}

function windDriverFromMeasurements(opts: {
  crossedFast: boolean;
  peakSpeed: number;
  densest: number | null;
  hottest: number | null;
  bz: number | null;
}): string {
  const { crossedFast, peakSpeed, densest, hottest, bz } = opts;
  const shockLike =
    crossedFast &&
    densest != null &&
    densest >= 5 &&
    hottest != null &&
    hottest >= 200_000;
  const parts: string[] = [];
  if (shockLike) {
    parts.push(
      `In this RTSW window the wind reached ${Math.round(peakSpeed)} km/s with density up to ${densest.toFixed(1)} cm⁻³ and proton temperature up to ${Math.round(hottest).toLocaleString()} K — the measured signature of a shock or CME-sheath passage at L1.`,
    );
  } else if (crossedFast) {
    parts.push(
      `In this RTSW window the wind crossed and held above the 500 km/s fast-stream line (peak ${Math.round(peakSpeed)} km/s). That is the measured high-speed stream at L1; assign the solar driver from the flare / CME / coronal-hole catalogue above, not from speed alone.`,
    );
  } else {
    parts.push(
      `In this RTSW window the wind stayed below the 500 km/s fast-stream line (peak ${Math.round(peakSpeed)} km/s) — measured slow wind at L1.`,
    );
  }
  if (bz == null) {
    parts.push("IMF Bz is unavailable at the latest wind sample, so southward coupling cannot be confirmed from this plot.");
  } else if (bz <= -5) {
    parts.push(
      `Latest Bz is ${bz.toFixed(1)} nT (southward). Coupling is open while this holds; a geomagnetic storm sentence still needs observed Kp ≥ 5 or Dst ≤ −50 nT together with Zimbabwe TEC/S4.`,
    );
  } else {
    parts.push(
      `Latest Bz is ${bz.toFixed(1)} nT. Southward Bz at or below −5 nT has to hold with this wind before Kp ≥ 5 or Dst ≤ −50 nT can be written as a storm.`,
    );
  }
  return parts.join(" ");
}

export function analyzeSolarWindPanel(
  data: HeliosphericMonitorResponse | null,
  brief: SolarWindBriefContext = null,
): ChartAnalysisBlock {
  const times = data?.solar_wind.times ?? [];
  const speed = data?.solar_wind.speed ?? [];
  const density = data?.solar_wind.density ?? [];
  const temperature = data?.solar_wind.temperature ?? [];
  const samples = times.map((time, index) => ({
    time,
    speed: speed[index],
    density: density[index],
    temperature: temperature[index],
  })).filter((sample): sample is { time: string; speed: number; density: number | null; temperature: number | null } =>
    sample.speed != null && Number.isFinite(sample.speed));

  if (!samples.length) {
    return {
      lead: "This graph shows the solar wind at Sun–Earth L1. Yellow is speed, blue is density, and orange is proton temperature. The dashed line at 500 km/s marks a fast stream. Name the driver from measured C/M/X flares, Earth-facing regions and CME status — not from generic wording.",
      bullets: [
        "No solar-wind plasma samples are available in the current RTSW window.",
        earthFacingActivitySentence(brief),
      ],
    };
  }

  const latest = samples[samples.length - 1];
  const peak = samples.reduce((best, sample) => (sample.speed > best.speed ? sample : best), samples[0]);
  const slowest = Math.min(...samples.map((sample) => sample.speed));
  const densest = samples.filter((sample) => sample.density != null && Number.isFinite(sample.density))
    .reduce<(typeof samples)[number] | null>((best, sample) => (!best || (sample.density as number) > (best.density as number) ? sample : best), null);
  const hottest = samples.filter((sample) => sample.temperature != null && Number.isFinite(sample.temperature))
    .reduce<(typeof samples)[number] | null>((best, sample) => (!best || (sample.temperature as number) > (best.temperature as number) ? sample : best), null);
  const crossedFast = samples.some((sample) => sample.speed >= 500);
  const bz = nearestSample(data?.imf.times, data?.imf.bz, latest.time);

  const now = `Latest solar wind is ${Math.round(latest.speed)} km/s at ${utcStamp(latest.time)}${latest.density != null ? `, density ${latest.density.toFixed(1)} cm⁻³` : ""}${latest.temperature != null ? `, proton temperature ${Math.round(latest.temperature).toLocaleString()} K` : ""}${bz != null ? `, with Bz ${bz.toFixed(1)} nT` : ""}.`;
  const range = `Across this plot the speed stayed between ${Math.round(slowest)} and ${Math.round(peak.speed)} km/s. The peak, ${Math.round(peak.speed)} km/s, was at ${utcStamp(peak.time)}.${crossedFast ? " The trace crossed the 500 km/s fast-stream line." : " The trace stayed under the 500 km/s fast-stream line."}`;
  const plasma = `${densest?.density != null ? `Density peaked at ${densest.density.toFixed(1)} cm⁻³ at ${utcStamp(densest.time)}. ` : ""}${hottest?.temperature != null ? `Proton temperature peaked at ${Math.round(hottest.temperature).toLocaleString()} K at ${utcStamp(hottest.time)}.` : ""}`.trim();
  const solarActivity = earthFacingActivitySentence(brief);
  const driver = windDriverFromMeasurements({
    crossedFast,
    peakSpeed: peak.speed,
    densest: densest?.density ?? null,
    hottest: hottest?.temperature ?? null,
    bz,
  });

  return {
    lead: "This graph shows the solar wind at Sun–Earth L1. Yellow is speed, blue is density, and orange is proton temperature. The dashed line at 500 km/s marks a fast stream. The driver is named from measured C-, M- and X-class flares, Earth-facing regions, eruption probability and CME status — together with this RTSW plasma.",
    bullets: [now, range, plasma, solarActivity, driver].filter(Boolean),
  };
}

export function analyzeKpForecastPanel(data: HeliosphericMonitorResponse | null): ChartAnalysisBlock {
  const kpTimes = data?.kp.times ?? [];
  const observed = kpTimes.map((time, index) => ({ time, value: data?.kp.observed?.[index] }))
    .filter((point): point is { time: string; value: number } => point.value != null && Number.isFinite(point.value));
  const predicted = kpTimes.map((time, index) => ({ time, value: data?.kp.predicted?.[index] }))
    .filter((point): point is { time: string; value: number } => point.value != null && Number.isFinite(point.value));
  const dstTimes = data?.dst?.times ?? [];
  const dstPoints = dstTimes.map((time, index) => ({ time, value: data?.dst?.dst?.[index] }))
    .filter((point): point is { time: string; value: number } => point.value != null && Number.isFinite(point.value));
  const speeds = (data?.solar_wind.speed ?? []).filter((value): value is number => value != null && Number.isFinite(value));
  const latestSpeed = speeds.length ? speeds[speeds.length - 1] : null;
  const peakSpeed = speeds.length ? Math.max(...speeds) : null;

  if (!observed.length && !dstPoints.length) {
    return {
      lead: "This graph shows the planetary magnetic response. The bars are Kp, from 0 to 9: green observed, amber estimated, and cyan the NOAA prediction. The line underneath is the Kyoto Dst ring current in nanotesla. Its importance is whether the field at Earth has already become a storm. NOAA G-scale wording is for high latitudes; Zimbabwe is checked with TEC and scintillation.",
      bullets: ["No observed Kp bars or Dst samples are available in the current NOAA window."],
    };
  }

  const latestKp = observed.length ? observed[observed.length - 1] : null;
  const peakKp = observed.length ? observed.reduce((best, point) => (point.value > best.value ? point : best), observed[0]) : null;
  const peakPred = predicted.length ? predicted.reduce((best, point) => (point.value > best.value ? point : best), predicted[0]) : null;
  const latestDst = dstPoints.length ? dstPoints[dstPoints.length - 1] : null;
  const lowDst = dstPoints.length ? dstPoints.reduce((best, point) => (point.value < best.value ? point : best), dstPoints[0]) : null;
  const storm = (peakKp != null && peakKp.value >= 5) || (lowDst != null && lowDst.value <= -50);

  const kpLine = latestKp
    ? `Latest observed Kp is ${latestKp.value.toFixed(2)} at ${utcStamp(latestKp.time)}.${peakKp ? ` The highest observed bar is ${peakKp.value.toFixed(2)} at ${utcStamp(peakKp.time)}.` : ""}${peakPred ? ` The highest NOAA predicted bar is ${peakPred.value.toFixed(2)} at ${utcStamp(peakPred.time)}.` : ""}`
    : "No observed Kp bars are available in the current NOAA forecast window.";
  const dstLine = latestDst
    ? `Latest Dst is ${Math.round(latestDst.value)} nT at ${utcStamp(latestDst.time)}.${lowDst ? ` The most negative Dst in this plot is ${Math.round(lowDst.value)} nT at ${utcStamp(lowDst.time)}.` : ""}${lowDst && lowDst.value <= -50 ? " That has reached the −50 nT weak-storm level." : " Dst near −50 nT is a weak storm and near −100 nT is a clear main phase. This line has not reached −50 nT."}`
    : "No Kyoto Dst samples are available in this window.";
  const windLine = latestSpeed != null
    ? `The solar wind with these bars is ${Math.round(latestSpeed)} km/s now${peakSpeed != null ? `, and the fastest speed in the same window is ${Math.round(peakSpeed)} km/s` : ""}.`
    : "";
  const verdict = storm
    ? "Kp has reached 5 or Dst has fallen through −50 nT, so this is a geomagnetic storm. For Zimbabwe, check whether TEC or S4 left the quiet-day curve while Bz was south."
    : `A peak of ${peakKp ? peakKp.value.toFixed(2) : "this size"} is ${peakKp && peakKp.value >= 4 ? "active" : "unsettled"}. Kp 5 would be G1. Zimbabwe is near 20°S, so the local check is TEC and scintillation on the CORS network.`;

  return {
    lead: "This graph shows the planetary magnetic response. The bars are Kp, from 0 to 9: green observed, amber estimated, and cyan the NOAA prediction. The line underneath is the Kyoto Dst ring current in nanotesla. Its importance is whether the field at Earth has already become a storm. NOAA G-scale wording is for high latitudes; Zimbabwe is checked with TEC and scintillation.",
    bullets: [kpLine, dstLine, `${windLine} ${verdict}`.trim()],
  };
}

export function analyzeHeliosphericPanel(
  id: HeliosphericPanelId,
  data: HeliosphericMonitorResponse | null,
  brief: SolarWindBriefContext = null,
): ChartAnalysisBlock {
  switch (id) {
    case "overview":
      return analyzeHeliosphericOverview();
    case "protons":
      return analyzeProtonFluxPanel(data);
    case "imf":
      return analyzeImfPanel(data);
    case "solar_wind":
      return analyzeSolarWindPanel(data, brief);
    case "kp":
      return analyzeKpForecastPanel(data);
  }
}
