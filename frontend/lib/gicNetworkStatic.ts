/**
 * Static ZETDC transmission network geometry for the GIC map.
 *
 * Mirrors zgiis/gic/network.py — this is fixed infrastructure metadata
 * (substation coordinates and HV line topology), not live sensor readings.
 * Used so the map renders even when the backend is unreachable; live GIC
 * status and measurements still require the API.
 */
import type { GicNetwork, GicStatusResponse } from "./types";

const SUBSTATIONS = [
  { code: "KARIBA", name: "Kariba", lat: -16.5219, lon: 28.7619 },
  { code: "ALASKA", name: "Alaska (Chinhoyi)", lat: -17.33, lon: 30.12 },
  { code: "MUTORASHANGA", name: "Mutorashanga", lat: -17.156, lon: 30.668 },
  { code: "WARREN", name: "Warren (Harare)", lat: -17.831, lon: 30.974 },
  { code: "HARARE", name: "Harare", lat: -17.809, lon: 31.085 },
  { code: "DEMA", name: "Dema (Seke)", lat: -18.063, lon: 31.199 },
  { code: "ORANGE_GROVE", name: "Orange Grove (Mutare)", lat: -18.931, lon: 32.625 },
  { code: "SHERWOOD", name: "Sherwood (Kwekwe)", lat: -18.937, lon: 29.818 },
  { code: "HAVEN", name: "Haven", lat: -19.1, lon: 29.65 },
  { code: "CHERTSEY", name: "Chertsey (Gweru)", lat: -19.49, lon: 29.66 },
  { code: "INSUKAMINI", name: "Insukamini (Bulawayo)", lat: -20.033, lon: 28.667 },
  { code: "HWANGE", name: "Hwange", lat: -18.38, lon: 26.47 },
  { code: "RUSHINGA", name: "Rushinga (border)", lat: -16.65, lon: 32.25 },
  { code: "SW_BORDER", name: "Southern interconnector (border)", lat: -21.85, lon: 28.2 },
] as const;

const LINES = [
  { from: "KARIBA", to: "ALASKA", kv: 330 },
  { from: "ALASKA", to: "WARREN", kv: 330 },
  { from: "MUTORASHANGA", to: "WARREN", kv: 330 },
  { from: "WARREN", to: "HARARE", kv: 330 },
  { from: "HARARE", to: "DEMA", kv: 330 },
  { from: "HARARE", to: "RUSHINGA", kv: 330 },
  { from: "DEMA", to: "ORANGE_GROVE", kv: 330 },
  { from: "WARREN", to: "SHERWOOD", kv: 330 },
  { from: "SHERWOOD", to: "HAVEN", kv: 330 },
  { from: "HAVEN", to: "CHERTSEY", kv: 330 },
  { from: "CHERTSEY", to: "INSUKAMINI", kv: 330 },
  { from: "HWANGE", to: "SHERWOOD", kv: 330 },
  { from: "HWANGE", to: "INSUKAMINI", kv: 330 },
  { from: "INSUKAMINI", to: "SW_BORDER", kv: 400 },
] as const;

const MONITORING_STATIONS = [
  {
    station_id: "MARIMBA_001",
    name: "Marimba (Harare)",
    substation: "WARREN",
    sensor: "GMW CPCO clamp sensor on transformer neutral/ground lead",
    datalogger: "Campbell Scientific CR1000",
    gateway: "Raspberry Pi 4 + 4G/LTE router (JSON/MQTT)",
    notes: "Pilot GIC monitoring station of the ZINGSA/ZETDC programme.",
  },
  {
    station_id: "ALASKA_001",
    name: "Alaska (Chinhoyi)",
    substation: "ALASKA",
    sensor: "GMW CPCO clamp sensor on transformer neutral/ground lead",
    datalogger: "Campbell Scientific CR1000",
    gateway: "Raspberry Pi 4 + 4G/LTE router (JSON/MQTT)",
    notes: "Planned/rotating deployment site.",
  },
] as const;

const RISK_BANDS = [
  { level: "Quiet", min_abs_a: 0, color: "#00ff88", meaning: "Background level — no transformer impact expected." },
  { level: "Elevated", min_abs_a: 5, color: "#a3e635", meaning: "Above background — watch space-weather indices." },
  { level: "Large", min_abs_a: 10, color: "#ff8c00", meaning: "Large GIC event (EPRI SUNBURST criterion). Log and cross-check Kp/Dst." },
  { level: "High", min_abs_a: 25, color: "#ff4444", meaning: "Even-order harmonic generation likely — asymmetric half-cycle core saturation onset." },
  { level: "Severe", min_abs_a: 35, color: "#d946ef", meaning: "Transformer core saturation with increased reactive power draw (~0.03 MVAr/A). Risk of heating/tripping." },
] as const;

function buildNetwork(): GicNetwork {
  const byCode = Object.fromEntries(SUBSTATIONS.map((s) => [s.code, s]));
  return {
    substations: [...SUBSTATIONS],
    lines: LINES.map((l) => ({
      from: l.from,
      to: l.to,
      kv: l.kv,
      coords: [
        [byCode[l.from].lat, byCode[l.from].lon],
        [byCode[l.to].lat, byCode[l.to].lon],
      ],
    })),
    monitoring_stations: [...MONITORING_STATIONS],
    risk_bands: [...RISK_BANDS],
  };
}

/** Default station registry when /gic/status is unreachable. */
export function staticGicStatus(): GicStatusResponse {
  return {
    stations: MONITORING_STATIONS.map((m) => ({
      station_id: m.station_id,
      name: m.name,
      substation: m.substation,
      sensor: m.sensor,
      datalogger: m.datalogger,
      gateway: m.gateway,
      record_count: 0,
      first_sample: null,
      last_sample: null,
      latest_gic_a: null,
      latest_level: null,
      has_data: false,
    })),
    total_records: 0,
  };
}

export const STATIC_GIC_NETWORK: GicNetwork = buildNetwork();
