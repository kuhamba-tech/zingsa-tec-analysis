from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect

from backend.deps import require_api_key
from backend.schemas import (
    LiveObservation,
    LivePipelineStatus,
    LiveStationVtecPoint,
    LiveStationVtecSeries,
    LiveVtecHealth,
    LiveVtecStationHealth,
    NtripProbeResponse,
    StationLiveStatus,
    TecMethodComparisonResponse,
    TecMethodInfo,
    TecMethodReference,
    TecMethodStationCompare,
)

router = APIRouter(prefix="/live", tags=["live"])


@router.get("/tec-climatology")
async def tec_climatology(
    start: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    tz: str = Query("CAT", pattern="^(CAT|UTC)$"),
    minutes: int = Query(60),
    regions: str = Query("", max_length=100),
    stations: str = Query("", max_length=200),
    seasons: str = Query("", max_length=1000),
    _=Depends(require_api_key),
):
    from zgiis.processing.tec_climatology import build
    try:
        return await asyncio.to_thread(build, _db(), start, end, tz, minutes,
            regions.split(",") if regions else None,
            stations.split(",") if stations else None,
            json.loads(seasons) if seasons else None)
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(400, str(exc)) from exc
log = logging.getLogger(__name__)

_VTEC_BY_STATION_CACHE: dict[tuple[float, int], tuple[float, list[LiveStationVtecSeries]]] = {}
_VTEC_BY_STATION_CACHE_TTL_S = 90.0
_VTEC_LATEST_CACHE: tuple[float, list[LiveStationVtecSeries]] | None = None
_VTEC_LATEST_CACHE_TTL_S = 20.0
# Chart queries fill the default thread pool. This card must still run.
_FRESH_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="zgiis-fresh")
# Station GOPI history must not wait behind a stuck session-pool checkout.
_CHART_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="zgiis-vtec-chart")
_HISTORY_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="zgiis-vtec-history")

# Heavy Gg re-calibration — short TTL so Zimbabwe tab does not stampede the worker.
_TEC_METHOD_CMP_CACHE: dict[tuple[float, str | None, int], tuple[float, TecMethodComparisonResponse]] = {}
_TEC_METHOD_CMP_CACHE_TTL_S = 180.0
_TEC_METHOD_PERIOD_CACHE: dict[str, tuple[float, dict]] = {}
_TEC_METHOD_CMP_INFLIGHT: dict[tuple[float, str | None, int], asyncio.Future] = {}

_SCI_PLOTS_CACHE: dict[tuple[float, int], tuple[float, dict]] = {}
_SCI_PLOTS_CACHE_TTL_S = 120.0
_SEASONAL_ARCHIVE_CACHE: tuple[float, dict] | None = None

_NS_RESEARCH_CACHE: dict[tuple[float, int], tuple[float, dict]] = {}
_NS_RESEARCH_CACHE_TTL_S = 90.0


def _db():
    try:
        from backend.live_manager import get_db
        return get_db()
    except Exception:
        return None


def _monitor():
    try:
        from backend.live_manager import get_monitor
        return get_monitor()
    except Exception:
        return None


def _safe_float(value) -> float | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out else None  # NaN check


def _safe_str(value) -> str | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    text = str(value).strip()
    return text or None


def _build_live_vtec(
    *,
    hours: float,
    station: str | None,
    limit: int,
    enrich_geometry: bool,
) -> list[LiveObservation]:
    """Sync builder — run via asyncio.to_thread so look-angle math cannot stall the event loop."""
    db = _db()
    if db is None:
        return []
    try:
        # Cap at SQL: never pull hundreds of thousands of NTRIP rows into pandas.
        fetch_limit = max(int(limit) * 4, int(limit) + 200) if limit else None
        df = db.query_recent(hours=hours, station=station, limit=fetch_limit)
        if df is None or getattr(df, "empty", True):
            return []
        if "tec_method" in df.columns:
            method = df["tec_method"].astype(str)
            # Keep live pipeline decode only (code_live / phase_only_live*).
            live_mask = method.str.contains("live", case=False, na=False) & ~method.str.startswith("dlr_")
            # Also drop anything that looks like archive/post-process.
            live_mask &= ~method.str.contains("archive|rinex|cmn", case=False, na=False)
            if bool(live_mask.any()):
                df = df.loc[live_mask]
            else:
                return []
        # Evenly subsample so elevation / constellation charts stay responsive.
        if len(df) > limit:
            step = max(1, len(df) // limit)
            df = df.iloc[::step].head(limit)

        nav = None
        if enrich_geometry:
            try:
                from backend.live_manager import ensure_broadcast_ephemeris, get_nav_cache

                # Cap the wait so a cold BRDC download cannot hold the API
                # worker while phone and laptop metric cards are loading.
                # The background refresh keeps filling the cache; a later
                # poll attaches azimuth once satellites are available.
                ensure_broadcast_ephemeris(wait_s=3.0)
                nav = get_nav_cache()
                if nav.gps_sv_count() <= 0:
                    nav = None
            except Exception:
                nav = None

        look_cache: dict[tuple[str, str, int], tuple[float, float] | None] = {}
        cols = set(df.columns)
        has_elev = "elevation_deg" in cols
        has_vtec = "vtec_tecu" in cols
        has_stec = "stec_tecu" in cols
        has_const = "constellation" in cols
        has_prn = "prn" in cols
        has_station = "station" in cols
        has_time = "time" in cols

        result: list[LiveObservation] = []
        for row in df.itertuples(index=False):
            elev = _safe_float(getattr(row, "elevation_deg", None)) if has_elev else None
            az = None
            prn = _safe_str(getattr(row, "prn", None)) if has_prn else None
            stn = _safe_str(getattr(row, "station", None)) if has_station else None
            time_raw = getattr(row, "time", "") if has_time else ""
            if nav is not None and prn and stn:
                try:
                    epoch = datetime.fromisoformat(str(time_raw).replace("Z", "+00:00"))
                    bucket = int(epoch.timestamp() // 60)
                except Exception:
                    epoch = None
                    bucket = -1
                cache_key = (stn.lower(), prn.upper(), bucket)
                if cache_key in look_cache:
                    look = look_cache[cache_key]
                else:
                    look = nav.look_angles(stn, prn, epoch)
                    look_cache[cache_key] = look
                if look is not None:
                    if elev is None:
                        elev = look[0]
                    az = look[1]
            result.append(
                LiveObservation(
                    time=str(time_raw or ""),
                    station=stn or "",
                    vtec_tecu=_safe_float(getattr(row, "vtec_tecu", None)) if has_vtec else None,
                    stec_tecu=_safe_float(getattr(row, "stec_tecu", None)) if has_stec else None,
                    elevation_deg=elev,
                    azimuth_deg=az,
                    constellation=_safe_str(getattr(row, "constellation", None)) if has_const else None,
                    prn=prn,
                    tec_method=_safe_str(getattr(row, "tec_method", None)) if "tec_method" in cols else "gopi_live",
                    bias_method=_safe_str(getattr(row, "bias_method", None)) if "bias_method" in cols else None,
                )
            )
        return result
    except Exception:
        log.exception("live vtec build failed")
        return []


@router.get("/vtec", response_model=list[LiveObservation])
async def live_vtec(
    hours: float = Query(2.0, ge=0.1, le=48),
    station: str | None = Query(None),
    limit: int = Query(2500, ge=100, le=20000),
    enrich_geometry: bool = Query(True),
    _=Depends(require_api_key),
):
    """Live NTRIP VTEC only — DLR Global TEC and RINEX archive rows are excluded."""
    return await asyncio.to_thread(
        _build_live_vtec,
        hours=hours,
        station=station,
        limit=limit,
        enrich_geometry=enrich_geometry,
    )


def _reconcile_gg_with_neighbors(stations: list[TecMethodStationCompare]) -> None:
    """Retune a station Gg that disagrees with its own GOPI and its neighbours.

    Neighbours that share one calibration offset are left alone. A station whose
    offset is far from that neighbourhood, while its GOPI matches the
    neighbourhood, has a failed arc bias. Its Gg is reset to GOPI plus the
    neighbours' Gg−GOPI offset. Stations with no usable Gg get the same fix
    when the neighbourhood is stable.
    """
    from zgiis.cors.stations import get_station

    agree_tecu = 8.0
    neighbor_k = 4

    def site_of(row: TecMethodStationCompare):
        return get_station((row.station or "").lower())

    located = [row for row in stations if row.gopi_latest is not None and site_of(row) is not None]
    if len(located) < 3:
        return

    def nearest(row: TecMethodStationCompare, pool: list[TecMethodStationCompare]) -> list[TecMethodStationCompare]:
        origin = site_of(row)
        if origin is None:
            return []
        ranked: list[tuple[float, TecMethodStationCompare]] = []
        for other in pool:
            if other is row:
                continue
            site = site_of(other)
            if site is None:
                continue
            ranked.append((math.hypot(site.lat - origin.lat, site.lon - origin.lon), other))
        ranked.sort(key=lambda item: item[0])
        return [other for _, other in ranked[:neighbor_k]]

    def outlier(row: TecMethodStationCompare, pool: list[TecMethodStationCompare]) -> bool:
        if row.gg_latest is None:
            return True
        peers = nearest(row, pool)
        if len(peers) < 2:
            return False
        peer_g = sorted(float(p.gopi_latest) for p in peers if p.gopi_latest is not None)
        peer_d = sorted(float(p.gg_latest) - float(p.gopi_latest) for p in peers if p.gg_latest is not None and p.gopi_latest is not None)
        if len(peer_g) < 2 or len(peer_d) < 2:
            return False
        if max(peer_d) - min(peer_d) > 12.0:
            return False
        g_ref = peer_g[len(peer_g) // 2]
        d_ref = peer_d[len(peer_d) // 2]
        if abs(float(row.gopi_latest) - g_ref) > agree_tecu:
            return False
        return abs((float(row.gg_latest) - float(row.gopi_latest)) - d_ref) > agree_tecu

    controls = [row for row in located if row.gg_latest is not None]
    flagged = {id(row) for row in controls if outlier(row, controls)}
    controls = [row for row in controls if id(row) not in flagged]

    for row in located:
        peers = nearest(row, controls)
        if len(peers) < 2:
            continue
        peer_g = sorted(float(p.gopi_latest) for p in peers if p.gopi_latest is not None)
        peer_d = sorted(
            float(p.gg_latest) - float(p.gopi_latest)
            for p in peers
            if p.gg_latest is not None and p.gopi_latest is not None
        )
        if len(peer_g) < 2 or len(peer_d) < 2 or max(peer_d) - min(peer_d) > 12.0:
            continue
        g_ref = peer_g[len(peer_g) // 2]
        d_ref = peer_d[len(peer_d) // 2]
        if abs(float(row.gopi_latest) - g_ref) > agree_tecu:
            continue
        local_d = None if row.gg_latest is None else float(row.gg_latest) - float(row.gopi_latest)
        if local_d is not None and abs(local_d - d_ref) <= agree_tecu:
            continue
        fixed = float(row.gopi_latest) + d_ref
        if not (1.0 < fixed < 90.0):
            continue
        row.gg_latest = round(fixed, 2)
        row.delta_latest = round(fixed - float(row.gopi_latest), 2)
        if row.gg_mean is None or (
            row.gopi_mean is not None and abs(float(row.gg_mean) - float(row.gopi_mean)) > 15.0
        ):
            row.gg_mean = row.gg_latest
            if row.gopi_mean is not None:
                row.delta_mean = round(row.gg_latest - float(row.gopi_mean), 2)


def _station_method_summary(
    gopi: list[LiveObservation],
    gg: list[LiveObservation],
) -> tuple[list[TecMethodStationCompare], dict]:
    """Aggregate per-station latest + mean VTEC for GOPI vs Gg comparison."""

    def _bucket(rows: list[LiveObservation]) -> dict[str, list[tuple[str, str, float]]]:
        out: dict[str, list[tuple[str, str, float]]] = {}
        for o in rows:
            code = (o.station or "").strip().upper()
            if not code or o.vtec_tecu is None:
                continue
            try:
                val = float(o.vtec_tecu)
            except (TypeError, ValueError):
                continue
            if not (0.0 < val < 90.0):
                continue
            out.setdefault(code, []).append((str(o.time or ""), str(o.prn or ""), val))
        return out

    def _agreed_level(rows: list[tuple[str, str, float]]) -> tuple[float | None, float | None]:
        """Satellite consensus, so one repeated PRN cannot set the station.

        Victoria Falls at 01:19 UTC had 59 copies of G31 near 65 TECU and one
        sample each of G08 and G27 near 6 TECU. A sample median printed 64.8.
        The same consensus the heat-map GOPI label uses withholds that split.
        """
        if not rows:
            return None, None
        from zgiis.maps.heatmap_data import (
            _fresh_station_vtec_from_group,
            _prn_consensus_station_vtec,
        )

        frame = pd.DataFrame(rows, columns=["time", "prn", "vtec_tecu"])
        latest = _fresh_station_vtec_from_group(frame)
        agreed = _prn_consensus_station_vtec(frame)
        return latest, agreed

    # Live Gg on short NTRIP windows can still diverge; hide pairs where
    # |Δ| exceeds a calibration-failure threshold so map labels stay physical.
    # Karoi printed Gg 0.4 beside GOPI 25 when one satellite's arc bias was
    # 28 TECU. A 15 TECU gap is already too large to show as the station value.
    MAX_PAIR_DELTA_TECU = 15.0

    gopi_b = _bucket(gopi)
    gg_b = _bucket(gg)
    codes = sorted(set(gopi_b) | set(gg_b))
    stations: list[TecMethodStationCompare] = []
    deltas_latest: list[float] = []
    deltas_mean: list[float] = []

    for code in codes:
        g_rows = sorted(gopi_b.get(code, []), key=lambda t: t[0])
        q_rows = sorted(gg_b.get(code, []), key=lambda t: t[0])
        g_vals = [v for _, _, v in g_rows]
        q_vals = [v for _, _, v in q_rows]
        g_latest, g_mean = _agreed_level(g_rows)
        q_latest, q_mean = _agreed_level(q_rows)
        d_latest = (q_latest - g_latest) if (q_latest is not None and g_latest is not None) else None
        d_mean = (q_mean - g_mean) if (q_mean is not None and g_mean is not None) else None
        if d_latest is not None and abs(d_latest) > MAX_PAIR_DELTA_TECU:
            q_latest = None
            d_latest = None
        if d_mean is not None and abs(d_mean) > MAX_PAIR_DELTA_TECU:
            q_mean = None
            d_mean = None
        if d_latest is not None:
            deltas_latest.append(d_latest)
        if d_mean is not None:
            deltas_mean.append(d_mean)
        stations.append(
            TecMethodStationCompare(
                station=code,
                gopi_latest=round(g_latest, 2) if g_latest is not None else None,
                gg_latest=round(q_latest, 2) if q_latest is not None else None,
                gopi_mean=round(g_mean, 2) if g_mean is not None else None,
                gg_mean=round(q_mean, 2) if q_mean is not None else None,
                delta_latest=round(d_latest, 2) if d_latest is not None else None,
                delta_mean=round(d_mean, 2) if d_mean is not None else None,
                gopi_samples=len(g_vals),
                gg_samples=len(q_vals),
                gopi_time=g_rows[-1][0] if g_rows else None,
                gg_time=q_rows[-1][0] if q_rows else None,
            )
        )

    _reconcile_gg_with_neighbors(stations)
    deltas_latest = [s.delta_latest for s in stations if s.delta_latest is not None]
    deltas_mean = [s.delta_mean for s in stations if s.delta_mean is not None]

    def _avg(xs: list[float]) -> float | None:
        return round(sum(xs) / len(xs), 2) if xs else None

    summary = {
        "station_count": len(stations),
        "paired_stations": sum(1 for s in stations if s.gopi_latest is not None and s.gg_latest is not None),
        "mean_delta_latest_tecu": _avg(deltas_latest),
        "mean_delta_mean_tecu": _avg(deltas_mean),
        "gopi_sample_count": len(gopi),
        "gg_sample_count": len(gg),
    }
    return stations, summary


def _build_tec_method_comparison(
    *,
    hours: float,
    station: str | None,
    limit: int,
) -> TecMethodComparisonResponse:
    from zgiis.processing.gg_calibration import (
        calibrate_gg_from_observations,
        method_catalog,
        references,
        try_pytecgg_available,
    )

    # Bound samples per receiver: a busy site must not hide the other stations.
    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
    codes = [station] if station else [s.code.lower().rstrip("_") for s in ZIMBABWE_CORS_STATIONS]
    gopi_rows = []
    for code in dict.fromkeys(codes):
        gopi_rows.extend(_build_live_vtec(
            hours=hours, station=code, limit=limit, enrich_geometry=False,
        ))
    # Tag as GOPI for comparison UI even when DB method strings vary.
    gopi: list[LiveObservation] = []
    for obs in gopi_rows:
        gopi.append(
            obs.model_copy(
                update={
                    "tec_method": obs.tec_method or "gopi_live",
                    "bias_method": obs.bias_method or "gopi_seemala_or_live_code",
                }
            )
        )

    # Station lat/lon feed MODIP μ and Local Time (notebook §3.2) — calibration key.
    try:
        from zgiis.cors.stations import get_station as _get_cors_station
    except Exception:  # pragma: no cover
        _get_cors_station = None  # type: ignore[assignment]

    station_ll: dict[str, tuple[float, float]] = {}

    def _station_ll(code: str) -> tuple[float, float]:
        key = (code or "").lower()
        if key in station_ll:
            return station_ll[key]
        lat, lon = -19.0, 30.0
        if _get_cors_station is not None and key:
            try:
                st = _get_cors_station(key)
                if st is not None:
                    lat, lon = float(st.lat), float(st.lon)
            except Exception:
                pass
        station_ll[key] = (lat, lon)
        return lat, lon

    gg_input: list[dict] = []
    for o in gopi:
        lat, lon = _station_ll(o.station)
        gg_input.append(
            {
                "time": o.time,
                "station": o.station,
                "prn": o.prn,
                "constellation": o.constellation,
                "elevation_deg": o.elevation_deg,
                "azimuth_deg": o.azimuth_deg,
                "stec_tecu": o.stec_tecu,
                "vtec_tecu": o.vtec_tecu,
                "lat": lat,
                "lon": lon,
            }
        )

    # Keep receiver/satellite bias arcs independent across stations.
    gg_raw = []
    for code in dict.fromkeys(o["station"] for o in gg_input):
        samples = sorted((o for o in gg_input if o["station"] == code), key=lambda o: o["time"])
        gg_raw.extend(calibrate_gg_from_observations(samples))
    gg = [
        LiveObservation(
            time=str(r.get("time") or ""),
            station=str(r.get("station") or ""),
            vtec_tecu=r.get("vtec_tecu"),
            stec_tecu=r.get("stec_tecu"),
            elevation_deg=r.get("elevation_deg"),
            azimuth_deg=r.get("azimuth_deg"),
            constellation=r.get("constellation"),
            prn=r.get("prn"),
            tec_method=str(r.get("tec_method") or "gg_ciraolo_window_ls"),
            bias_method=str(r.get("bias_method") or "gg_arc_bias_modip_lt_poly"),
            arc_bias_tecu=r.get("arc_bias_tecu"),
        )
        for r in gg_raw
    ]

    stations, summary = _station_method_summary(gopi, gg)
    pytecgg = try_pytecgg_available()
    engine = "gg_modip_lt_window_ls"
    if pytecgg:
        engine_note = (
            f"Engine {engine} (PyTECGg importable): live comparison applies Gg = Cesaroni "
            "MODIP×LT windowed least-squares to streaming CORS rows — not a full "
            "RINEX-day PyTECGg run (that path is for offline obs+nav processing)."
        )
    else:
        engine_note = (
            f"Engine {engine}: Gg = Cesaroni arc-bias + VTEC(MODIP μ, LT) "
            "polynomial on the same streaming samples (PyTECGg not installed for full RINEX days)."
        )
    note = (
        "Method 1 (GOPI / Seemala) is the live CORS NTRIP dual-frequency path shown on the "
        "TEC Heat Map. Method 2 (Gg = Cesaroni) uses Ciraolo/Cesaroni calibration "
        "(refs Ciraolo 2007, Cesaroni 2015/2021, Ventriglia/PyTECGg 2026). "
        f"{engine_note} Both methods use elev ≥ 30° and IPP shell 350 km so ΔVTEC = Gg − GOPI "
        "reflects calibration, not geometry. Large live gaps usually mean underconstrained "
        "Gg arc biases on short NTRIP windows (not a second ionosphere) — trust G for "
        "operations; Gg is a research overlay until a full RINEX-day PyTECGg run."
    )
    return TecMethodComparisonResponse(
        available=bool(gopi),
        hours=hours,
        sample_limit=limit,
        gopi=gopi,
        gg=gg,
        stations=stations,
        methods=[TecMethodInfo(**m) for m in method_catalog()],
        references=[TecMethodReference(**r) for r in references()],
        note=note,
        summary=summary,
    )


@router.get("/tec-method-comparison", response_model=TecMethodComparisonResponse)
async def tec_method_comparison(
    hours: float = Query(6.0, ge=0.5, le=48),
    station: str | None = Query(None),
    limit: int = Query(2500, ge=100, le=10000),
    _=Depends(require_api_key),
):
    """Compare GOPI / Seemala live TEC with Gg (Ciraolo–Cesaroni) calibration.

    Same underlying CORS samples and geometry (elev ≥ 30°, IPP 350 km);
    Gg applies arc-bias + windowed VTEC polynomial calibration so differences
    reflect calibration method, not a different network or shell model.
    """
    # Cap work: comparison UI does not need 10k samples and two parallel builds
    # were hanging the single uvicorn worker (socket hang-ups → blank page).
    hours = float(min(8.0, max(0.5, hours)))
    limit = int(min(600, max(100, limit)))
    cache_key = (round(hours, 1), (station or "").lower() or None, limit)
    now = time.time()
    cached = _TEC_METHOD_CMP_CACHE.get(cache_key)
    if cached and (now - cached[0]) < _TEC_METHOD_CMP_CACHE_TTL_S:
        return cached[1]

    inflight = _TEC_METHOD_CMP_INFLIGHT.get(cache_key)
    if inflight is not None and not inflight.done():
        return await inflight

    loop = asyncio.get_running_loop()
    fut: asyncio.Future = loop.create_future()
    _TEC_METHOD_CMP_INFLIGHT[cache_key] = fut

    async def _run() -> TecMethodComparisonResponse:
        try:
            result = await asyncio.to_thread(
                _build_tec_method_comparison,
                hours=hours,
                station=station,
                limit=limit,
            )
            _TEC_METHOD_CMP_CACHE[cache_key] = (time.time(), result)
            if not fut.done():
                fut.set_result(result)
            return result
        except Exception as exc:
            if not fut.done():
                fut.set_exception(exc)
            raise
        finally:
            if _TEC_METHOD_CMP_INFLIGHT.get(cache_key) is fut:
                _TEC_METHOD_CMP_INFLIGHT.pop(cache_key, None)

    return await _run()


@router.get("/tec-method-periods")
async def tec_method_periods(
    day: str | None = Query(None),
    _=Depends(require_api_key),
):
    """Measured GOPI, Gg, and global TEC for morning, afternoon, and night.

    Values come from the hourly log. A part of the day with no stored
    measurements is left empty.
    """
    selected = (day or "").strip()[:10]
    if selected and (len(selected) != 10 or selected[4] != "-" or selected[7] != "-"):
        selected = ""
    cache_key = selected
    now = time.time()
    cached = _TEC_METHOD_PERIOD_CACHE.get(cache_key)
    if cached and (now - cached[0]) < _TEC_METHOD_CMP_CACHE_TTL_S:
        return cached[1]
    from zgiis.processing.tec_method_hour_log import period_comparison

    result = await asyncio.to_thread(period_comparison, selected or None)
    _TEC_METHOD_PERIOD_CACHE[cache_key] = (time.time(), result)
    return result


@router.get("/vtec-by-station", response_model=list[LiveStationVtecSeries])
async def live_vtec_by_station(
    hours: float = Query(6.0, ge=0.5, le=168),
    resample_minutes: int = Query(2, ge=1, le=60),
    latest_only: bool = Query(False),
    _=Depends(require_api_key),
):
    """Binned live NTRIP VTEC vs time for every Zimbabwe CORS station.

    Used by the National Dashboard / TEC heat-map pages so operators can verify
    station VTEC against the map snapshot. Prefers absolute code TEC
    (``code_live`` from the NTRIP pipeline). Aggregation stays in SQL so
    continuous ingest cannot stall the chart endpoint.

    ``latest_only`` skips the history bins and returns the 15-minute Gopi
    satellite consensus. The ionosphere card uses that path so a slow chart
    query cannot blank the current station mean.
    """
    if latest_only:
        global _VTEC_LATEST_CACHE
        now = time.time()
        if _VTEC_LATEST_CACHE and (now - _VTEC_LATEST_CACHE[0]) < _VTEC_LATEST_CACHE_TTL_S:
            return _VTEC_LATEST_CACHE[1]
        result = await asyncio.get_running_loop().run_in_executor(
            _FRESH_EXECUTOR,
            _build_live_vtec_latest,
        )
        _VTEC_LATEST_CACHE = (now, result)
        return result

    cache_key = (float(hours), int(resample_minutes))
    now = time.time()
    cache_ttl = 300.0 if hours >= 48 else _VTEC_BY_STATION_CACHE_TTL_S
    cached = _VTEC_BY_STATION_CACHE.get(cache_key)
    if cached and (now - cached[0]) < cache_ttl:
        return cached[1]

    result = await asyncio.get_running_loop().run_in_executor(
        _HISTORY_EXECUTOR if hours >= 48 else _CHART_EXECUTOR,
        lambda h=hours, step=resample_minutes: _build_live_vtec_by_station(
            hours=h,
            resample_minutes=step,
        ),
    )
    # A failed read used to cache an empty series and the blue GOPI line
    # stayed where the last successful response ended.
    if any(row.points for row in result) or cache_key not in _VTEC_BY_STATION_CACHE:
        _VTEC_BY_STATION_CACHE[cache_key] = (time.time(), result)
        return result
    previous = _VTEC_BY_STATION_CACHE.get(cache_key)
    if previous is not None and (time.time() - previous[0]) < 600:
        return previous[1]
    _VTEC_BY_STATION_CACHE[cache_key] = (time.time(), result)
    return result


def _build_live_vtec_latest() -> list[LiveStationVtecSeries]:
    """One current code-TEC value per station for the ionosphere and CORS cards.

    Reads the same pooled station list as CORS Connected. A separate session
    connection was refused once the database client limit was full, and both
    cards then stayed on Unavailable.
    """
    from datetime import datetime, timezone

    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

    from backend.routers.cors_network import _fresh_code_live_connections

    observed = datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z")
    fresh = _fresh_code_live_connections()
    series: list[LiveStationVtecSeries] = []
    for station in sorted(ZIMBABWE_CORS_STATIONS, key=lambda item: item.code):
        code = station.code.lower().rstrip("_")
        value = fresh.get(code)
        points: list[LiveStationVtecPoint] = []
        latest: float | None = None
        if value is not None and value > 0:
            latest = round(float(value), 2)
            points = [LiveStationVtecPoint(time=observed, vtec_tecu=latest, obs_count=1)]
        series.append(
            LiveStationVtecSeries(
                station=code,
                name=station.name,
                points=points,
                latest_vtec=latest,
                mean_vtec=latest,
            )
        )
    return series


def _utc_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


def _build_live_vtec_by_station(
    *,
    hours: float,
    resample_minutes: int,
) -> list[LiveStationVtecSeries]:
    """Binned GOPI history for the station charts.

    Uses the transaction pooler with a short statement timeout. The session
    pool is capped and a checkout there was hanging, so the charts kept the
    last series (GOPI stopped near 07:55 UTC while later measurements existed).
    """
    import psycopg2

    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
    from zgiis.db.config import pooled_database_dsn

    catalog = {
        s.code.lower().rstrip("_"): s
        for s in ZIMBABWE_CORS_STATIONS
    }
    empty = [
        LiveStationVtecSeries(station=code, name=station.name, points=[])
        for code, station in sorted(catalog.items(), key=lambda item: item[0])
    ]
    dsn = pooled_database_dsn()
    if not dsn:
        return empty

    since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
    step = max(1, int(resample_minutes))
    timeout_ms = int(min(45000 if hours > 48 else 20000, 6000 + float(hours) * 500))
    conn = None
    try:
        conn = psycopg2.connect(dsn, connect_timeout=5)
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(f"SET statement_timeout = '{timeout_ms}'")
            cur.execute(
                """
                SELECT LOWER(RTRIM(station, '_')) AS station,
                       to_timestamp(
                         floor(extract(epoch FROM time) / %s) * %s
                       ) AT TIME ZONE 'UTC' AS bucket,
                       MAX(time) AS observed_at,
                       AVG(vtec_tecu) AS vtec_tecu,
                       COUNT(*) AS obs_count
                FROM vtec_obs
                WHERE time >= %s
                  AND vtec_tecu IS NOT NULL
                  AND vtec_tecu > 0
                  AND vtec_tecu <= 50
                  AND elevation_deg >= 20
                  AND tec_method LIKE %s
                  AND tec_method NOT LIKE 'dlr_%%'
                GROUP BY 1, 2
                ORDER BY 1, 2
                """,
                (float(step * 60), float(step * 60), since, "%code_live%"),
            )
            bin_rows = cur.fetchall()
            latest_since = (datetime.now(tz=timezone.utc) - timedelta(minutes=15)).isoformat()
            cur.execute(
                """
                SELECT LOWER(RTRIM(station, '_')) AS station,
                       AVG(vtec_tecu) AS mean_vtec
                FROM vtec_obs
                WHERE time >= %s
                  AND vtec_tecu > 0
                  AND vtec_tecu <= 50
                  AND tec_method LIKE %s
                GROUP BY 1
                """,
                (latest_since, "%code_live%"),
            )
            latest_rows = cur.fetchall()
    except Exception as exc:
        message = str(exc).splitlines()[0]
        if "://" in message or "@" in message:
            message = type(exc).__name__
        log.warning("live vtec-by-station read failed: %s", message[:240])
        return []
    finally:
        if conn is not None:
            conn.close()

    gopi_by: dict[str, float] = {}
    for code, mean in latest_rows:
        key = str(code or "").lower().rstrip("_")
        try:
            value = float(mean)
        except (TypeError, ValueError):
            continue
        if key and value > 0:
            gopi_by[key] = round(value, 2)

    points_by: dict[str, list[LiveStationVtecPoint]] = {code: [] for code in catalog}
    for station, bucket, observed_at, vtec, obs_count in bin_rows:
        key = str(station or "").lower().rstrip("_")
        if key not in points_by:
            continue
        try:
            value = float(vtec)
        except (TypeError, ValueError):
            continue
        if not (value > 0 and value <= 50):
            continue
        when = observed_at if isinstance(observed_at, datetime) else bucket
        if not isinstance(when, datetime):
            continue
        stamp = _utc_iso(when)
        if not stamp:
            continue
        try:
            count = int(obs_count or 0)
        except (TypeError, ValueError):
            count = 0
        points_by[key].append(
            LiveStationVtecPoint(time=stamp, vtec_tecu=round(value, 2), obs_count=count)
        )

    series: list[LiveStationVtecSeries] = []
    for code, station in sorted(catalog.items(), key=lambda item: item[0]):
        points = points_by.get(code) or []
        values = [point.vtec_tecu for point in points]
        series.append(
            LiveStationVtecSeries(
                station=code,
                name=station.name,
                points=points,
                latest_vtec=gopi_by.get(code),
                mean_vtec=round(sum(values) / len(values), 2) if values else None,
            )
        )
    return series if any(row.points for row in series) else empty


@router.get("/zimbabwe-scientific-plots")
async def zimbabwe_scientific_plots(
    hours: float = Query(24.0, ge=6.0, le=72.0),
    resample_minutes: int = Query(15, ge=5, le=60),
    day: str | None = Query(None),
    archive_only: bool = Query(False),
    _=Depends(require_api_key),
):
    """Four scientific TEC plots for Zimbabwe with observation-based uncertainty.

    1. Diurnal N/C/S latitudinal VTEC (IQR bands)
    2. Seasonal equinox/solstice composites from CMN archive (where available)
    3. TEC versus approximate MODIP along the N–S CORS transect
    4. Quiet (Kp<3) vs disturbed (Kp≥3) diurnal composites

    Values are never synthesised — missing seasons/regimes are flagged.
    """
    hours = float(min(48.0, max(6.0, hours)))
    resample_minutes = int(min(60, max(5, resample_minutes)))
    selected_day = (day or "").strip()[:10]
    if selected_day and len(selected_day) != 10:
        selected_day = ""
    if archive_only:
        global _SEASONAL_ARCHIVE_CACHE
        now = time.time()
        cached_archive = _SEASONAL_ARCHIVE_CACHE
        if cached_archive and (now - cached_archive[0]) < _SCI_PLOTS_CACHE_TTL_S:
            return cached_archive[1]
        archive_result = await asyncio.to_thread(_seasonal_archive_payload)
        _SEASONAL_ARCHIVE_CACHE = (time.time(), archive_result)
        return archive_result

    cache_key = (round(hours, 1), resample_minutes, selected_day)
    now = time.time()
    cached = _SCI_PLOTS_CACHE.get(cache_key)
    if cached and (now - cached[0]) < _SCI_PLOTS_CACHE_TTL_S:
        return cached[1]

    result = await asyncio.to_thread(
        _build_scientific_plots,
        hours=hours,
        resample_minutes=resample_minutes,
        day=selected_day or None,
    )
    _SCI_PLOTS_CACHE[cache_key] = (time.time(), result)
    return result


def _empty_percentile(hours: int = 24) -> dict:
    return {"p50": [None] * hours, "p25": [None] * hours, "p75": [None] * hours, "n": [0] * hours}


def _seasonal_archive_payload() -> dict:
    """Equinox/solstice diurnal curves from the packaged CMN file. No database."""
    from zgiis.processing.zimbabwe_scientific_plots import build_seasonal_equinox_solstice

    seasonal = build_seasonal_equinox_solstice()
    hours = list(range(24))
    band = _empty_percentile()
    return {
        "generated_at": datetime.now(tz=timezone.utc).isoformat(),
        "hours": 24,
        "resample_minutes": 60,
        "day": None,
        "logged_days": [],
        "diurnal_latband": {
            "hours": hours,
            "northern": band,
            "central": _empty_percentile(),
            "southern": _empty_percentile(),
            "station_counts": {"northern": 0, "central": 0, "southern": 0},
            "sample_count": 0,
            "note": "Live latitude bands are loaded separately from measured CORS bins.",
        },
        "seasonal": seasonal,
        "modip_transect": {"points": [], "regression": None},
        "quiet_disturbed": {
            "hours": hours,
            "quiet": _empty_percentile(),
            "disturbed": _empty_percentile(),
            "quiet_sample_count": 0,
            "disturbed_sample_count": 0,
            "kp_threshold": 3.0,
            "available": False,
        },
        "integrity": {
            "no_synthetic_tec": True,
            "uncertainty": "Seasonal curves are hourly medians from the CMN archive.",
            "seasonal_archive_limited": not all(
                bool(season.get("available")) for season in seasonal.get("seasons") or []
            ),
            "modip_approximate": True,
        },
    }


def _build_scientific_plots(*, hours: float, resample_minutes: int, day: str | None = None) -> dict:
    from zgiis.processing.zimbabwe_scientific_plots import build_zimbabwe_scientific_plots
    from zgiis.space_weather.fetch_indices import _fetch_noaa_kp_history, _parse_kp_value

    kp_points: list[dict] = []
    try:
        for row in _fetch_noaa_kp_history() or []:
            if not isinstance(row, dict):
                continue
            t = row.get("time_tag") or row.get("time")
            v = _parse_kp_value(row)
            if t is None or v is None:
                continue
            kp_points.append({"t": str(t), "v": float(v)})
    except Exception:
        log.debug("scientific plots: could not preload Kp", exc_info=True)

    return build_zimbabwe_scientific_plots(
        hours=hours,
        resample_minutes=resample_minutes,
        kp_points=kp_points,
        day=day,
    )


@router.get("/north-south-tec-research")
async def north_south_tec_research(
    hours: float = Query(24.0, ge=1.0, le=720.0),
    resample_minutes: int = Query(15, ge=1, le=60),
    _=Depends(require_api_key),
):
    """North–South Zimbabwe VTEC research payload from live CORS archive.

    Returns station metadata, quality metrics, suggested N–S transect, and
    binned VTEC time series for interactive spatial analysis. Values are never
    synthesised — empty ranges report an explicit unavailable message.
    """
    hours = float(min(720.0, max(1.0, hours)))
    # Cap aggressive queries when the archive is short (typical live retention).
    resample_minutes = int(min(60, max(1, resample_minutes)))
    if hours > 48:
        resample_minutes = max(resample_minutes, 15)
    if hours > 168:
        resample_minutes = max(resample_minutes, 30)

    cache_key = (round(hours, 1), resample_minutes)
    now = time.time()
    cached = _NS_RESEARCH_CACHE.get(cache_key)
    if cached and (now - cached[0]) < _NS_RESEARCH_CACHE_TTL_S:
        return cached[1]

    result = await asyncio.to_thread(
        _build_north_south_tec_research,
        hours=hours,
        resample_minutes=resample_minutes,
    )
    _NS_RESEARCH_CACHE[cache_key] = (time.time(), result)
    return result


def _build_north_south_tec_research(*, hours: float, resample_minutes: int) -> dict:
    from zgiis.processing.north_south_tec_research import build_north_south_tec_research

    return build_north_south_tec_research(
        hours=hours,
        resample_minutes=resample_minutes,
        db=_db(),
    )


@router.get("/stations", response_model=list[StationLiveStatus])
async def live_stations(_=Depends(require_api_key)):
    from backend.live_manager import status as live_status
    from zgiis.cors.stations import stations_for_map_live
    live = live_status()
    streams = live.get("streams") or {}
    mon = _monitor()
    stations = stations_for_map_live(streams)
    latest_by_station: dict = {}
    mean_by_station: dict = {}
    db = _db()
    try:
        # The collector holds one caster socket and gives each connected
        # ZINGSA station about a minute. A full pass of the stations that
        # are actually online takes roughly 15 minutes, so a 90-second
        # cutoff leaves every card except the current socket blank. Show
        # the mean TEC from each station's latest visit during that pass.
        # Stations with no measurement in the pass stay empty.
        reader = getattr(type(db), "live_station_mean_vtec", None) if db is not None else None
        if reader is not None:
            mean_by_station = {
                str(code).lower().rstrip("_"): value
                for code, value in (db.live_station_mean_vtec(seconds=20 * 60) or {}).items()
            }
            latest_by_station = {code: {"vtec_tecu": value} for code, value in mean_by_station.items()}
        else:
            df = db.query_recent(hours=90.0 / 3600.0) if db else None
            if df is not None and not df.empty and "station" in df.columns:
                if "tec_method" in df.columns:
                    method = df["tec_method"].astype(str)
                    live_mask = method.str.contains("live", case=False, na=False)
                    live_mask &= ~method.str.contains("dlr|archive|rinex|cmn", case=False, na=False)
                    df = df[live_mask]
                if "time" in df.columns:
                    observed_at = pd.to_datetime(df["time"], utc=True, errors="coerce")
                    cutoff = datetime.now(timezone.utc) - timedelta(seconds=20 * 60)
                    df = df[observed_at >= cutoff]
                if not df.empty:
                    latest = df.sort_values("time").groupby("station").tail(1).set_index("station")
                    latest_by_station = latest.to_dict(orient="index")
                    if "vtec_tecu" in df.columns:
                        mean_by_station = df.groupby("station")["vtec_tecu"].mean().to_dict()
    except Exception:
        latest_by_station = {}
        mean_by_station = {}

    result = []
    for s in stations:
        lat_ms = None
        msg_rt = None
        stale = True
        last_vtec = s.current_tec if s.current_tec else None
        code = s.code.lower()
        stream = streams.get(code)
        if mon:
            try:
                stats = mon.latency(code)
                lat_ms = stats.get("mean_ms")
                msg_rt = mon.msg_rate(code)
                stale = mon.is_stale(code)
            except Exception:
                pass
        if code in latest_by_station:
            stale = False
            last_vtec = float(mean_by_station.get(code, latest_by_station[code].get("vtec_tecu") or 0.0))
        # A TCP connection without a recent decoded MSM message is not live
        # station data. Keep it stale and do not expose a cached TEC value.
        if stale:
            last_vtec = None
        result.append(StationLiveStatus(
            code=s.code,
            name=s.name,
            lat=s.lat,
            lon=s.lon,
            latency_ms=lat_ms,
            msg_rate=msg_rt,
            stale=stale,
            last_vtec=last_vtec,
        ))
    return result


@router.get("/vtec-health", response_model=LiveVtecHealth)
async def live_vtec_health(_=Depends(require_api_key)):
    """Operational live VTEC health for dashboard banners and diagnostics."""
    from zgiis.live.vtec_health import build_live_vtec_health

    payload = await asyncio.to_thread(build_live_vtec_health)
    return LiveVtecHealth(
        **{
            **payload,
            "stations": [LiveVtecStationHealth(**row) for row in payload.get("stations") or []],
        }
    )


@router.get("/pipeline-status", response_model=LivePipelineStatus)
async def pipeline_status(_=Depends(require_api_key)):
    import os

    from backend.live_manager import status as live_status
    # Skip full-table COUNT(*) — under continuous NTRIP ingest that scans
    # the observation table and stalls every dashboard poll.
    s = live_status(include_record_counts=False)
    db = _db()
    record_count = 0
    # The dedicated collector writes Supabase. This API process does not
    # start NTRIP, so the hour count has to come from the database or the
    # dashboard reports the pipeline as stopped while rows are still arriving.
    recent_record_count_1h = int(s.get("recent_vtec_records_1h") or 0)
    active_streams = int(s["active_streams"] or 0)
    streams = dict(s.get("streams") or {})
    message = s.get("message")
    ingest_enabled = bool(s.get("ingest_enabled", True))
    try:
        if db is not None:
            recent_record_count_1h = int(db.recent_code_live_count(hours=1.0))
            if active_streams == 0:
                from zgiis.cors.stations import is_surveyor_general

                codes = [
                    code
                    for code in db.recent_code_live_station_codes(hours=0.25)
                    if code and not is_surveyor_general(code)
                ]
                if codes:
                    active_streams = len(codes)
                    ingest_enabled = True
                    message = "Dedicated collector is storing live TEC for the ZINGSA stations."
    except Exception as exc:
        log.warning("pipeline recent TEC count failed: %s", exc)
    db_backend = s.get("db_backend") or "supabase"
    if db_backend == "unknown":
        db_backend = "supabase"
    try:
        if db:
            db_backend = db.backend
    except Exception:
        if db_backend == "unknown":
            db_backend = "supabase"
    return LivePipelineStatus(
        ntrip_configured=s["configured"] or active_streams > 0,
        active_streams=active_streams,
        streams=streams,
        db_backend=db_backend,
        db_env_key=s.get("db_env_key"),
        db_host_kind=s.get("db_host_kind", "supabase"),
        record_count=record_count,
        recent_record_count_1h=recent_record_count_1h,
        diagnostics=s.get("diagnostics") or {},
        runtime_mode=s.get("runtime_mode", "persistent-process"),
        ingest_enabled=ingest_enabled,
        message=message,
    )


@router.get("/ntrip-status", response_model=NtripProbeResponse)
async def ntrip_status(
    refresh: bool = Query(False),
    listen_sec: float = Query(4.0, ge=2.0, le=12.0),
    _=Depends(require_api_key),
):
    """Cached live NTRIP probe — real caster TCP/RTCM decode, refreshed every ~2 min."""
    from zgiis.live.ntrip_status_cache import get_cached_ntrip_probe

    payload = get_cached_ntrip_probe(refresh=refresh, listen_sec=listen_sec)
    return NtripProbeResponse(**payload)


@router.post("/ntrip-probe", response_model=NtripProbeResponse)
async def ntrip_probe(
    listen_sec: float = Query(6.0, ge=2.0, le=20.0),
    _=Depends(require_api_key),
):
    """Probe each configured NTRIP mountpoint without stopping the live collector."""
    from zgiis.live.ntrip_status_cache import get_cached_ntrip_probe

    payload = get_cached_ntrip_probe(refresh=True, listen_sec=listen_sec)
    return NtripProbeResponse(**payload)


@router.websocket("/stream")
async def live_stream(ws: WebSocket):
    await ws.accept()
    db = _db()
    try:
        last_latest_time: str | None = None
        while True:
            if db:
                try:
                    df = db.query_recent(hours=0.1)
                    if not df.empty:
                        latest_time = str(df["time"].max())
                        if latest_time != last_latest_time:
                            last_latest_time = latest_time
                            latest = df.tail(10)
                            rows = []
                            for _, row in latest.iterrows():
                                rows.append({
                                    "time": str(row.get("time", "")),
                                    "station": str(row.get("station", "")),
                                    "vtec_tecu": float(row["vtec_tecu"]) if "vtec_tecu" in row else None,
                                })
                            await ws.send_text(json.dumps(rows))
                except Exception:
                    pass
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        pass
