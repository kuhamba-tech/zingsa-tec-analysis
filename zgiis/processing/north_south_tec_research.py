"""North–South Zimbabwe VTEC research calculations and payload builder.

Scientific integrity rules:
- Only use measured CORS VTEC from ``vtec_obs`` (code_live preferred).
- Never synthesise TEC values.
- Geomagnetic (IGRF QD / AACGM) coordinates are marked unavailable unless a
  validated library is configured — do not approximate with a constant offset.
- Independent GIM/IONEX validation is a stub until a reference product is wired.
"""

from __future__ import annotations

import math
import statistics
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Sequence

# Geographic N/C/S bands (same as zimbabweLatBands / scientific plots).
NORTH_LAT = -18.2
CENTRAL_LAT = -20.2

CAT_OFFSET_HOURS = 2.0  # Central Africa Time = UTC+2

MIN_LAT_SEP_DEG = 0.15  # refuse gradient when stations are effectively co-located
SYNC_TOLERANCE_S = 900  # 15 min default sync window for ΔVTEC pairs


def zimbabwe_lat_band(lat: float) -> str:
    if lat > NORTH_LAT:
        return "northern"
    if lat > CENTRAL_LAT:
        return "central"
    return "southern"


def utc_iso_to_cat_hour(iso: str) -> float | None:
    """Fractional hour of day in CAT (UTC+2) from an ISO-8601 UTC timestamp."""
    try:
        t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    cat = t.astimezone(timezone(timedelta(hours=2)))
    return cat.hour + cat.minute / 60.0 + cat.second / 3600.0


def pairwise_delta_vtec(vtec_north: float, vtec_south: float) -> float:
    return float(vtec_north) - float(vtec_south)


def pairwise_latitudinal_gradient(
    vtec_north: float,
    vtec_south: float,
    lat_north: float,
    lat_south: float,
    *,
    min_sep_deg: float = MIN_LAT_SEP_DEG,
) -> float | None:
    """G_φ = (VTEC_N − VTEC_S) / (lat_N − lat_S) in TECU/degree.

    Uses signed latitudes. Returns None when latitude separation is insufficient.
    """
    dlat = float(lat_north) - float(lat_south)
    if abs(dlat) < min_sep_deg:
        return None
    return (float(vtec_north) - float(vtec_south)) / dlat


def linear_regression(
    xs: Sequence[float],
    ys: Sequence[float],
) -> dict[str, float | int | None]:
    """Ordinary least-squares: y = intercept + slope * x."""
    n = min(len(xs), len(ys))
    if n < 2:
        return {
            "n": n,
            "slope": None,
            "intercept": None,
            "r_squared": None,
            "stderr_slope": None,
        }
    x = [float(xs[i]) for i in range(n)]
    y = [float(ys[i]) for i in range(n)]
    mean_x = sum(x) / n
    mean_y = sum(y) / n
    ss_xx = sum((xi - mean_x) ** 2 for xi in x)
    ss_yy = sum((yi - mean_y) ** 2 for yi in y)
    ss_xy = sum((x[i] - mean_x) * (y[i] - mean_y) for i in range(n))
    if ss_xx <= 0:
        return {
            "n": n,
            "slope": None,
            "intercept": None,
            "r_squared": None,
            "stderr_slope": None,
        }
    slope = ss_xy / ss_xx
    intercept = mean_y - slope * mean_x
    ss_res = sum((y[i] - (intercept + slope * x[i])) ** 2 for i in range(n))
    r_squared = 1.0 - (ss_res / ss_yy) if ss_yy > 0 else None
    stderr = None
    if n > 2 and ss_xx > 0:
        stderr = math.sqrt(ss_res / (n - 2) / ss_xx)
    return {
        "n": n,
        "slope": round(slope, 6),
        "intercept": round(intercept, 6),
        "r_squared": round(r_squared, 6) if r_squared is not None else None,
        "stderr_slope": round(stderr, 6) if stderr is not None else None,
    }


def multi_station_latitudinal_gradient(
    latitudes: Sequence[float],
    vtecs: Sequence[float],
) -> dict[str, float | int | None]:
    """Regression-based spatial gradient β₁ where VTEC = β₀ + β₁·latitude."""
    return linear_regression(latitudes, vtecs)


def suggest_north_south_transect(
    stations: Sequence[dict[str, Any]],
    *,
    max_stations: int = 7,
) -> list[str]:
    """Suggest a N–S transect maximizing lat span while limiting lon scatter.

    Score = lat_span − 0.35·lon_span (degrees). Prefer stations with live VTEC.
    """
    usable = [
        s
        for s in stations
        if s.get("lat") is not None
        and s.get("lon") is not None
        and math.isfinite(float(s["lat"]))
        and math.isfinite(float(s["lon"]))
    ]
    if not usable:
        return []

    # Prefer stations that currently have VTEC, then fill from the rest.
    with_vtec = [s for s in usable if s.get("latest_vtec") is not None]
    pool = with_vtec if len(with_vtec) >= 3 else usable
    pool = sorted(pool, key=lambda s: float(s["lat"]), reverse=True)

    if len(pool) <= max_stations:
        return [str(s["station_id"]).lower() for s in pool]

    # Take northernmost, southernmost, then fill evenly in latitude.
    north = pool[0]
    south = pool[-1]
    mid = pool[1:-1]
    if not mid:
        return [str(north["station_id"]).lower(), str(south["station_id"]).lower()]

    target_extra = max_stations - 2
    # Greedy: pick points that improve lat coverage vs lon cost.
    selected = [north, south]
    remaining = list(mid)
    while remaining and len(selected) - 2 < target_extra:
        best_i = 0
        best_score = -1e18
        for i, cand in enumerate(remaining):
            trial = selected + [cand]
            lats = [float(s["lat"]) for s in trial]
            lons = [float(s["lon"]) for s in trial]
            score = (max(lats) - min(lats)) - 0.35 * (max(lons) - min(lons))
            if cand.get("latest_vtec") is not None:
                score += 0.2
            if score > best_score:
                best_score = score
                best_i = i
        selected.append(remaining.pop(best_i))

    selected = sorted(selected, key=lambda s: float(s["lat"]), reverse=True)
    return [str(s["station_id"]).lower() for s in selected]


def synchronize_pairs(
    north_points: Sequence[dict[str, Any]],
    south_points: Sequence[dict[str, Any]],
    *,
    tolerance_s: float = SYNC_TOLERANCE_S,
) -> list[dict[str, Any]]:
    """Match northern/southern observations within tolerance_s (no silent interp)."""
    south = sorted(
        [
            p
            for p in south_points
            if p.get("vtec_tecu") is not None and p.get("timestamp_utc")
        ],
        key=lambda p: p["timestamp_utc"],
    )
    if not south:
        return []

    def _ms(iso: str) -> float | None:
        try:
            t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
            return t.timestamp()
        except ValueError:
            return None

    south_ms = [(_ms(p["timestamp_utc"]), p) for p in south]
    south_ms = [(t, p) for t, p in south_ms if t is not None]
    out: list[dict[str, Any]] = []
    j = 0
    for np_ in north_points:
        if np_.get("vtec_tecu") is None or not np_.get("timestamp_utc"):
            continue
        tn = _ms(np_["timestamp_utc"])
        if tn is None:
            continue
        while j + 1 < len(south_ms) and abs(south_ms[j + 1][0] - tn) <= abs(
            south_ms[j][0] - tn
        ):
            j += 1
        ts, sp = south_ms[j]
        if abs(ts - tn) > tolerance_s:
            continue
        delta = pairwise_delta_vtec(float(np_["vtec_tecu"]), float(sp["vtec_tecu"]))
        out.append(
            {
                "timestamp_utc_north": np_["timestamp_utc"],
                "timestamp_utc_south": sp["timestamp_utc"],
                "sync_offset_s": round(tn - ts, 1),
                "vtec_north": float(np_["vtec_tecu"]),
                "vtec_south": float(sp["vtec_tecu"]),
                "delta_vtec": round(delta, 4),
            }
        )
    return out


def station_statistics(values: Sequence[float]) -> dict[str, float | None]:
    vals = [float(v) for v in values if v is not None and math.isfinite(float(v))]
    if not vals:
        return {
            "mean": None,
            "median": None,
            "min": None,
            "max": None,
            "std": None,
            "amplitude": None,
            "n": 0,
        }
    mean = statistics.fmean(vals)
    med = statistics.median(vals)
    mn = min(vals)
    mx = max(vals)
    std = statistics.pstdev(vals) if len(vals) > 1 else 0.0
    return {
        "mean": round(mean, 3),
        "median": round(med, 3),
        "min": round(mn, 3),
        "max": round(mx, 3),
        "std": round(std, 3),
        "amplitude": round(mx - mn, 3),
        "n": len(vals),
    }


def quality_control_flags(values: Iterable[float | None]) -> dict[str, int]:
    """Count QC issues without removing legitimate high TEC."""
    missing = 0
    invalid = 0
    negative = 0
    abrupt = 0
    prev: float | None = None
    for v in values:
        if v is None:
            missing += 1
            continue
        try:
            fv = float(v)
        except (TypeError, ValueError):
            invalid += 1
            continue
        if not math.isfinite(fv):
            invalid += 1
            continue
        if fv < 0:
            negative += 1
        if prev is not None and abs(fv - prev) > 40:
            abrupt += 1
        prev = fv
    return {
        "missing": missing,
        "invalid": invalid,
        "negative": negative,
        "abrupt_discontinuities": abrupt,
    }


def observation_completeness(
    valid: int,
    expected: int,
) -> dict[str, float | int | str]:
    if expected <= 0:
        return {
            "valid": valid,
            "expected": expected,
            "missing": 0,
            "completeness_pct": 0.0,
            "status": "no_expected_samples",
        }
    missing = max(0, expected - valid)
    pct = 100.0 * valid / expected
    status = "good" if pct >= 90 else ("fair" if pct >= 60 else "poor")
    return {
        "valid": valid,
        "expected": expected,
        "missing": missing,
        "completeness_pct": round(pct, 2),
        "status": status,
    }


def group_boundaries_from_stations(lats: Sequence[float]) -> dict[str, float]:
    """Derive N/C/S boundaries from the actual operational latitude span.

    Uses tertile cuts when ≥6 stations; otherwise falls back to catalog thresholds.
    """
    vals = sorted(float(x) for x in lats if math.isfinite(float(x)))
    if len(vals) < 6:
        return {
            "northern_min_lat": NORTH_LAT,
            "central_min_lat": CENTRAL_LAT,
            "method": "catalog_thresholds",
            "n_stations": len(vals),
        }
    # Tertiles on sorted ascending latitudes (south → north).
    n = len(vals)
    i1 = max(1, n // 3)
    i2 = max(i1 + 1, (2 * n) // 3)
    # Boundaries expressed as min lat of each band (exclusive lower for northern).
    central_min = vals[i1]
    northern_min = vals[i2]
    return {
        "northern_min_lat": round(northern_min, 4),
        "central_min_lat": round(central_min, 4),
        "method": "tertile_from_operational_stations",
        "n_stations": n,
    }


def build_north_south_tec_research(
    *,
    hours: float,
    resample_minutes: int,
    db: Any | None = None,
) -> dict[str, Any]:
    """Assemble research payload from live CORS archive (no synthetic TEC)."""
    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    processing_version = "zingsa-ns-research-1.0"
    data_source = "vtec_obs code_live (ZINGSA CORS NTRIP)"

    catalog = {s.code.lower().rstrip("_"): s for s in ZIMBABWE_CORS_STATIONS}
    series_by: dict[str, list[dict[str, Any]]] = {code: [] for code in catalog}
    latest_by: dict[str, float | None] = {code: None for code in catalog}
    newest_ts: str | None = None
    oldest_ts: str | None = None
    total_points = 0

    if db is not None:
        try:
            df = db.station_vtec_timeseries_binned(
                hours=hours,
                resample_minutes=resample_minutes,
                code_live_only=True,
            )
            if df is not None and not getattr(df, "empty", True):
                work = df.copy()
                work["station"] = work["station"].astype(str).str.lower().str.rstrip("_")
                work["bucket"] = __import__("pandas").to_datetime(
                    work["bucket"], utc=True, errors="coerce"
                )
                work["vtec_tecu"] = __import__("pandas").to_numeric(
                    work["vtec_tecu"], errors="coerce"
                )
                work = work.dropna(subset=["bucket", "vtec_tecu"])
                work = work[(work["vtec_tecu"] > 0) & (work["vtec_tecu"] < 200)]
                for code, group in work.groupby("station"):
                    key = str(code).lower().rstrip("_")
                    if key not in series_by:
                        continue
                    group = group.sort_values("bucket")
                    points = []
                    for _, row in group.iterrows():
                        ts = row["bucket"].isoformat().replace("+00:00", "Z")
                        v = round(float(row["vtec_tecu"]), 2)
                        points.append(
                            {
                                "timestamp_utc": ts,
                                "vtec_tecu": v,
                                "quality_flag": "ok",
                                "obs_count": int(row.get("obs_count") or 0),
                            }
                        )
                        if oldest_ts is None or ts < oldest_ts:
                            oldest_ts = ts
                        if newest_ts is None or ts > newest_ts:
                            newest_ts = ts
                    series_by[key] = points
                    total_points += len(points)
                    if points:
                        latest_by[key] = points[-1]["vtec_tecu"]
        except Exception:
            pass

    # Operational latitudes for grouping.
    op_lats = [
        float(s.lat)
        for code, s in catalog.items()
        if latest_by.get(code) is not None or (s.status or "").lower() == "online"
    ]
    bounds = group_boundaries_from_stations(op_lats)

    def band_for(lat: float) -> str:
        if bounds["method"] == "tertile_from_operational_stations":
            if lat >= float(bounds["northern_min_lat"]):
                return "northern"
            if lat >= float(bounds["central_min_lat"]):
                return "central"
            return "southern"
        return zimbabwe_lat_band(lat)

    stations_out: list[dict[str, Any]] = []
    for code, st in sorted(catalog.items()):
        pts = series_by.get(code) or []
        vals = [p["vtec_tecu"] for p in pts]
        expected = max(1, int((hours * 60) / max(1, resample_minutes)))
        qc = quality_control_flags(vals)
        comp = observation_completeness(len(vals), expected)
        stations_out.append(
            {
                "station_id": code,
                "name": st.name,
                "latitude": float(st.lat),
                "longitude": float(st.lon),
                "altitude_m": getattr(st, "height_m", None),
                "operational_status": st.status,
                "lat_band": band_for(float(st.lat)),
                "live_vtec_available": latest_by.get(code) is not None,
                "latest_vtec_tecu": latest_by.get(code),
                "latest_observation_utc": pts[-1]["timestamp_utc"] if pts else None,
                "observation_count": len(pts),
                "geomagnetic_latitude": None,
                "geomagnetic_longitude": None,
                "geomagnetic_status": "unavailable",
                "geomagnetic_note": (
                    "IGRF-based quasi-dipole / AACGM coordinates are not configured "
                    "in this deployment. Geographical latitude is used for spatial analysis."
                ),
                "statistics": station_statistics(vals),
                "quality": {**qc, **comp},
                "processing_version": processing_version,
                "data_source": data_source,
            }
        )

    suggested = suggest_north_south_transect(
        [
            {
                "station_id": s["station_id"],
                "lat": s["latitude"],
                "lon": s["longitude"],
                "latest_vtec": s["latest_vtec_tecu"],
            }
            for s in stations_out
        ]
    )

    # Archive availability for requested window.
    requested_hours = float(hours)
    span_hours = None
    if oldest_ts and newest_ts:
        try:
            a = datetime.fromisoformat(oldest_ts.replace("Z", "+00:00"))
            b = datetime.fromisoformat(newest_ts.replace("Z", "+00:00"))
            span_hours = round((b - a).total_seconds() / 3600.0, 2)
        except ValueError:
            span_hours = None

    historical_available = total_points > 0
    historical_message = None
    if not historical_available:
        historical_message = (
            "Historical observations are not yet available for this period."
        )
    elif span_hours is not None and span_hours + 1 < min(requested_hours, 24):
        historical_message = (
            f"Archive currently covers ~{span_hours} h of measured VTEC "
            f"(requested {requested_hours} h). Gaps are not interpolated."
        )

    # Regional means from latest samples (derived, labelled).
    band_vals: dict[str, list[float]] = {
        "northern": [],
        "central": [],
        "southern": [],
    }
    for s in stations_out:
        if s["latest_vtec_tecu"] is not None:
            band_vals[s["lat_band"]].append(float(s["latest_vtec_tecu"]))

    def _mean(xs: list[float]) -> float | None:
        return round(sum(xs) / len(xs), 3) if xs else None

    northern_mean = _mean(band_vals["northern"])
    central_mean = _mean(band_vals["central"])
    southern_mean = _mean(band_vals["southern"])
    ns_diff = None
    if northern_mean is not None and southern_mean is not None:
        ns_diff = round(northern_mean - southern_mean, 3)

    # Pairwise gradient on suggested N/S ends if available.
    gradient = None
    if len(suggested) >= 2:
        north_id, south_id = suggested[0], suggested[-1]
        n_st = next(s for s in stations_out if s["station_id"] == north_id)
        s_st = next(s for s in stations_out if s["station_id"] == south_id)
        if n_st["latest_vtec_tecu"] is not None and s_st["latest_vtec_tecu"] is not None:
            gradient = pairwise_latitudinal_gradient(
                float(n_st["latest_vtec_tecu"]),
                float(s_st["latest_vtec_tecu"]),
                float(n_st["latitude"]),
                float(s_st["latitude"]),
            )
            if gradient is not None:
                gradient = round(gradient, 4)

    active = sum(1 for s in stations_out if s["live_vtec_available"])
    completeness_vals = [
        float(s["quality"]["completeness_pct"])
        for s in stations_out
        if s["observation_count"] > 0
    ]
    mean_completeness = (
        round(sum(completeness_vals) / len(completeness_vals), 2)
        if completeness_vals
        else None
    )

    series_payload = {
        code: {
            "station_id": code,
            "points": pts,
        }
        for code, pts in series_by.items()
    }

    return {
        "generated_at": generated_at,
        "title": "Zimbabwe Ionospheric TEC: North–South Spatial Analysis",
        "hours_requested": requested_hours,
        "resample_minutes": int(resample_minutes),
        "processing_version": processing_version,
        "data_source": data_source,
        "vtec_method": "GOPI absolute code VTEC (elev≥30°, thin-shell IPP 350 km) via live NTRIP",
        "coordinate_model": {
            "geographical": "WGS84 station coordinates from ZINGSA CORS inventory",
            "geomagnetic": None,
            "geomagnetic_status": "unavailable",
            "geomagnetic_note": (
                "No IGRF quasi-dipole / AACGM service is configured. "
                "Spatial analysis uses geographical latitude only."
            ),
            "ipp_shell_km_default": 350,
            "ipp_shell_km_optional": 450,
            "ipp_status": (
                "Station-level VTEC is used for the initial analysis; "
                "per-epoch IPP coordinates are not exposed on the binned series endpoint."
            ),
        },
        "grouping": bounds,
        "catalog_band_thresholds": {
            "northern_min_lat": NORTH_LAT,
            "central_min_lat": CENTRAL_LAT,
        },
        "archive": {
            "historical_available": historical_available,
            "oldest_observation_utc": oldest_ts,
            "newest_observation_utc": newest_ts,
            "span_hours": span_hours,
            "total_binned_points": total_points,
            "message": historical_message,
            "retention_note": (
                "Live observations are stored in vtec_obs (Timescale/SQLite) with "
                "prune_older_than(days=90). Multi-week research requires continuous ingest; "
                "browser localStorage is not used as the archive."
            ),
        },
        "validation": {
            "configured": False,
            "message": "Independent TEC validation is not yet configured.",
            "reference_products": [],
        },
        "summary": {
            "northern_mean_vtec": northern_mean,
            "central_mean_vtec": central_mean,
            "southern_mean_vtec": southern_mean,
            "north_south_difference": ns_diff,
            "latitudinal_gradient_tecu_per_deg": gradient,
            "active_stations": active,
            "observation_completeness_pct": mean_completeness,
            "latest_observation_utc": newest_ts,
        },
        "suggested_transect": suggested,
        "sync_tolerance_s": SYNC_TOLERANCE_S,
        "stations": stations_out,
        "series": series_payload,
        "scientific_limitations": [
            "Preliminary 1–30 day research module — not a long-term TEC climatology.",
            "Positive north–south gradients are not interpreted as EIA evidence without independent analysis.",
            "Missing bins are left empty; values are never interpolated for charts or exports.",
            "Geomagnetic latitudes are unavailable until an IGRF QD/AACGM model is configured.",
        ],
    }
