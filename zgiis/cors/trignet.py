"""South African sites with authenticated live RTCM and public RINEX fallback.

TRIGNET_NTRIP_* settings isolate South African streams from Zimbabwe's caster.
Connection state is independent of the availability of a valid TEC sample.
"""
from __future__ import annotations

import ftplib
import base64
import json
import logging
import os
import shutil
import socket
import tempfile
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict, deque

log = logging.getLogger(__name__)

CASTER_HOST = "196.15.132.2"
CASTER_PORT = 2101
FTP_HOST = "ftp.trignet.co.za"
SOURCE_URL = "http://trignet.co.za/"

_CACHE_PATH = Path(__file__).resolve().parents[2] / "static" / "data" / "trignet_tec.json"
_LOCK = threading.Lock()
_CATALOG: dict[str, Any] = {"at": 0.0, "stations": []}
_DAY: dict[str, Any] = {"at": 0.0, "day": None}
_NAV: dict[str, Any] = {"day": None, "nav": {}}
_TEC: dict[str, dict[str, Any]] = {}
_STARTED = False
_LIVE_MANAGER = None
_LIVE_PIPELINE = None
_PYTECGG = None
_LIVE_CALIBRATION_ROWS = defaultdict(lambda: deque(maxlen=20000))
_CATALOG_TTL_S = 900
_DAY_TTL_S = 900
# A TrigNet file value is shown only when it falls in the same window as the
# live Zimbabwe feed. Older medians stay stored and the station is offline.
LIVE_TIME_MATCH = timedelta(minutes=30)


def parse_sourcetable(text: str) -> list[dict[str, Any]]:
    """Single-base TrigNet mounts with a real latitude and longitude.

    Virtual networks (0, 0) and the GPS+GLONASS-only duplicates are omitted.
    """
    by_code: dict[str, dict[str, Any]] = {}
    for line in text.splitlines():
        if not line.startswith("STR;"):
            continue
        parts = line.split(";")
        if len(parts) < 11:
            continue
        mount = parts[1].strip()
        upper = mount.upper()
        if "GPSGLOONLY" in upper or upper.startswith("RTKNET"):
            continue
        try:
            lat = float(parts[9])
            lon = float(parts[10])
        except ValueError:
            continue
        if abs(lat) < 1.0 and abs(lon) < 1.0:
            continue
        country = parts[8].strip().upper() if len(parts) > 8 else ""
        # One ZAF mount is published with a missing minus (Lsma-SB 28.55).
        # That point is in South Africa, not north of the equator.
        if country == "ZAF" and 22.0 <= lat <= 35.5:
            lat = -lat
        code = mount.split("_", 1)[0].split("-", 1)[0].strip().upper()
        if not (3 <= len(code) <= 5) or not code.isalnum():
            continue
        constellations = [item.strip() for item in parts[6].split("+") if item.strip()]
        row = {
            "code": code,
            "name": code,
            "lat": lat,
            "lon": lon,
            "mountpoint": mount,
            "constellations": constellations,
            "format": parts[3].strip(),
            "country": country,
        }
        previous = by_code.get(code)
        if previous is None or len(constellations) > len(previous["constellations"]):
            by_code[code] = row
    return sorted(by_code.values(), key=lambda row: (-row["lat"], row["code"]))


def _configured_caster() -> dict[str, Any] | None:
    """Keep South African account settings separate from Zimbabwe's NTRIP_* settings."""
    host = os.getenv("TRIGNET_NTRIP_HOST", "").strip().strip('"').strip("'")
    if not host:
        return None
    from urllib.parse import urlsplit

    parsed = urlsplit(host if "://" in host else f"ntrip://{host}")
    return {
        "host": parsed.hostname or host,
        "port": int(os.getenv("TRIGNET_NTRIP_PORT") or parsed.port or 2101),
        "username": os.getenv("TRIGNET_NTRIP_USERNAME", ""),
        "password": os.getenv("TRIGNET_NTRIP_PASSWORD", ""),
    }


def _fetch_sourcetable_text(
    host: str = CASTER_HOST, port: int = CASTER_PORT,
    username: str = "", password: str = "",
) -> str:
    auth = ""
    if username or password:
        token = base64.b64encode(f"{username}:{password}".encode()).decode("ascii")
        auth = f"Authorization: Basic {token}\r\n"
    request = (
        "GET / HTTP/1.0\r\n"
        f"Host: {host}:{port}\r\n"
        "User-Agent: NTRIP ZGIIS/1.0\r\n"
        "Accept: */*\r\n"
        f"{auth}"
        "Connection: close\r\n\r\n"
    )
    sock = socket.create_connection((host, port), timeout=10)
    try:
        sock.sendall(request.encode())
        chunks: list[bytes] = []
        total = 0
        while total < 400_000:
            chunk = sock.recv(65536)
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if b"ENDSOURCETABLE" in chunk:
                break
    finally:
        sock.close()
    text = b"".join(chunks).decode("latin1", "replace")
    first = text.splitlines()[0] if text else ""
    if "200" not in first:
        raise ValueError("South Africa caster did not return a successful sourcetable")
    return text


def catalog() -> list[dict[str, Any]]:
    now = time.monotonic()
    with _LOCK:
        cached = _CATALOG["stations"]
        if cached and now - float(_CATALOG["at"]) < _CATALOG_TTL_S:
            return list(cached)
    sources: list[dict[str, Any]] = [{}]
    configured = _configured_caster()
    if configured:
        sources.append(configured)
    by_code: dict[str, dict[str, Any]] = {}
    failed = False
    selected = {x.strip().upper() for x in os.getenv("TRIGNET_NTRIP_MOUNTPOINTS", "").split(",") if x.strip()}
    with ThreadPoolExecutor(max_workers=len(sources)) as pool:
        futures = [(source, pool.submit(_fetch_sourcetable_text, **source)) for source in sources]
        for source, future in futures:
            try:
                rows = parse_sourcetable(future.result())
            except Exception:
                # Never log account details or the Authorization header.
                log.warning("South Africa sourcetable unavailable at %s", source.get("host", CASTER_HOST))
                failed = True
                continue
            for row in rows:
                if row.get("country") != "ZAF":
                    continue
                if source and selected and row["mountpoint"].upper() not in selected and row["code"].upper() not in selected:
                    continue
                by_code[row["code"]] = row
    if failed:
        # A temporary failure at one caster must not remove its known site locations.
        with _LOCK:
            for row in _CATALOG["stations"]:
                by_code.setdefault(row["code"], row)
    rows = sorted(by_code.values(), key=lambda row: (-row["lat"], row["code"]))
    with _LOCK:
        _CATALOG["stations"] = rows
        _CATALOG["at"] = now
    return list(rows)


def _ftp() -> ftplib.FTP:
    ftp = ftplib.FTP(timeout=60)
    ftp.connect(FTP_HOST, 21)
    ftp.login()
    return ftp


def latest_rinex_day() -> date | None:
    now = time.monotonic()
    with _LOCK:
        cached = _DAY["day"]
        if cached is not None and now - float(_DAY["at"]) < _DAY_TTL_S:
            return cached
    year = datetime.now(timezone.utc).year
    try:
        ftp = _ftp()
        try:
            names: list[str] = []
            ftp.retrlines(f"NLST /RefData.{year % 100:02d}", names.append)
        finally:
            ftp.quit()
    except Exception:
        log.warning("TrigNet FTP day list failed", exc_info=True)
        with _LOCK:
            return _DAY["day"]
    doys = []
    for name in names:
        leaf = name.rstrip("/").split("/")[-1]
        if leaf.isdigit():
            doys.append(int(leaf))
    if not doys:
        return None
    day = date(year, 1, 1) + timedelta(days=max(doys) - 1)
    with _LOCK:
        _DAY["day"] = day
        _DAY["at"] = now
    return day


def _load_disk_cache() -> None:
    if not _CACHE_PATH.is_file():
        return
    try:
        payload = json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    rows = payload.get("stations")
    if isinstance(rows, dict):
        with _LOCK:
            _TEC.update(rows)


def _save_disk_cache(rinex_day: str) -> None:
    _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        payload = {
            "rinex_day": rinex_day,
            "stations": _TEC,
            "saved_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        }
    _CACHE_PATH.write_text(json.dumps(payload), encoding="utf-8")


def _download(ftp_path: str, dest: Path) -> None:
    ftp = _ftp()
    try:
        with dest.open("wb") as handle:
            ftp.retrbinary(f"RETR {ftp_path}", handle.write)
    finally:
        ftp.quit()


def _decompress_obs(crx_gz: Path, dest: Path) -> None:
    from hatanaka import decompress

    raw = decompress(crx_gz.read_bytes())
    if isinstance(raw, str):
        raw = raw.encode("ascii", "replace")
    dest.write_bytes(raw)


_CODE_PAIRS = (("C1C", "C2W"), ("C1W", "C2W"), ("C1C", "C2C"), ("C1C", "C2X"), ("C1C", "C2L"))


def _sv_number(sv: Any) -> int | None:
    text = str(sv).strip().upper()
    if not text.startswith("G"):
        return None
    try:
        return int(text[1:])
    except ValueError:
        return None


def median_gg_vtec(rows: list[dict[str, Any]]) -> tuple[float | None, int]:
    """Median Cesaroni Gg VTEC from the same code-TEC samples. None if the fit fails."""
    if not rows:
        return None, 0
    import math

    import numpy as np

    from zgiis.processing.gg_calibration import calibrate_gg_from_observations

    values: list[float] = []
    for item in calibrate_gg_from_observations(rows):
        try:
            value = float(item["vtec_tecu"])
        except (KeyError, TypeError, ValueError):
            continue
        if math.isfinite(value) and value > 0:
            values.append(value)
    if not values:
        return None, 0
    return round(float(np.median(values)), 2), len(values)


def _record_live_calibration(sample: dict[str, Any]) -> None:
    """Retain station-local arcs for the same Gg fit used by Zimbabwe CORS."""
    code = str(sample.get("station") or "").lower().rstrip("_")
    if not code or "code_live" not in str(sample.get("tec_method") or ""):
        return
    with _LOCK:
        rows = _LIVE_CALIBRATION_ROWS[code]
        rows.append({**sample, "time": sample["epoch"]})
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
        while rows and rows[0]["time"] < cutoff:
            rows.popleft()


def _live_gg_vtec(code: str, lat: float, lon: float) -> tuple[float | None, int]:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
    with _LOCK:
        rows = [dict(row, lat=lat, lon=lon) for row in _LIVE_CALIBRATION_ROWS.get(code, ())
                if row["time"] >= cutoff]
    rows.sort(key=lambda row: row["time"])
    return median_gg_vtec(rows)


def compute_station_vtec(code: str, day: date, nav_by_sv: dict[int, dict]) -> dict[str, Any] | None:
    """Median GOPI and Cesaroni VTEC for the last two hours of that day's 30 s file.

    Only GPS epochs with an elevation of at least 30 degrees are used, the
    same mask as the live code-TEC path. Gg is omitted when the arc-bias fit
    does not return a value.
    """
    if not nav_by_sv:
        return None
    import math

    import georinex as gr
    import numpy as np
    import pandas as pd

    from zgiis.live.satellite_geometry import llh_to_ecef, look_angles_ecef
    from zgiis.live.stec_vtec import tecg_from_pseudorange, vtec_from_stec
    from zgiis.processing.elevation_mask import ELEVATION_MIN_DEG

    yy = day.year % 100
    doy = day.timetuple().tm_yday
    stamp = f"{day.year}{doy:03d}0000"
    folder = f"/RefData.{yy:02d}/{doy:03d}/Daily_30sec/{code}"
    obs_name = f"{code}00ZAF_R_{stamp}_01D_30S_MO.crx.gz"
    work = Path(tempfile.mkdtemp(prefix=f"trignet_{code}_"))
    try:
        crx = work / obs_name
        _download(f"{folder}/{obs_name}", crx)
        obs = work / f"{code.lower()}.rnx"
        _decompress_obs(crx, obs)
        end = datetime(day.year, day.month, day.day, 23, 59, tzinfo=timezone.utc)
        start = end - timedelta(hours=2)
        meas = sorted({name for pair in _CODE_PAIRS for name in pair})
        import warnings

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", FutureWarning)
            loaded = gr.load(
                str(obs),
                use="G",
                meas=meas,
                tlim=[start.strftime("%Y-%m-%dT%H:%M"), end.strftime("%Y-%m-%dT%H:%M")],
            )
        if not hasattr(loaded, "data_vars"):
            return None
        header_lat = getattr(loaded, "position_geodetic", None)
        lat = lon = None
        if header_lat is not None:
            try:
                lat = float(header_lat[0])
                lon = float(header_lat[1])
            except (TypeError, ValueError, IndexError):
                lat = lon = None
        station = next((row for row in catalog() if row["code"] == code), None)
        if lat is None or lon is None or not math.isfinite(lat):
            if station is None:
                return None
            lat, lon = float(station["lat"]), float(station["lon"])
        rx = llh_to_ecef(lat, lon, 0.0)
        present = [pair for pair in _CODE_PAIRS if pair[0] in loaded and pair[1] in loaded]
        if not present:
            return None
        c1_name, c2_name = present[0]
        times = pd.to_datetime(loaded.time.values)
        svs = [str(sv) for sv in loaded.sv.values]
        c1 = np.asarray(loaded[c1_name].values, dtype=float)
        c2 = np.asarray(loaded[c2_name].values, dtype=float)
        values: list[float] = []
        gg_rows: list[dict[str, Any]] = []
        last_time: datetime | None = None
        for index in range(0, len(times), 2):
            epoch = times[index].to_pydatetime()
            if epoch.tzinfo is None:
                epoch = epoch.replace(tzinfo=timezone.utc)
            for sv_index, sv in enumerate(svs):
                p1 = c1[index, sv_index]
                p2 = c2[index, sv_index]
                if not (math.isfinite(p1) and math.isfinite(p2)):
                    continue
                if p1 < 15_000_000 or p2 < 15_000_000:
                    continue
                sv_num = _sv_number(sv)
                nav = None if sv_num is None else nav_by_sv.get(sv_num)
                if nav is None:
                    continue
                look = look_angles_ecef(rx, nav, epoch)
                if look is None or look[0] < ELEVATION_MIN_DEG:
                    continue
                stec = tecg_from_pseudorange(p1, p2)
                vtec = vtec_from_stec(stec, look[0])
                if math.isfinite(vtec) and 0.5 < vtec < 150:
                    values.append(vtec)
                    last_time = epoch
                    gg_rows.append({
                        "time": epoch,
                        "prn": sv,
                        "elevation_deg": look[0],
                        "vtec_tecu": vtec,
                        "lat": lat,
                        "lon": lon,
                    })
        if not values or last_time is None:
            return None
        gg_vtec, gg_samples = median_gg_vtec(gg_rows)
        return {
            "vtec": round(float(np.median(values)), 2),
            "gg_vtec": gg_vtec,
            "time": last_time.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "samples": len(values),
            "gg_samples": gg_samples,
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _nav_for_day(day: date) -> dict[int, dict]:
    key = day.isoformat()
    with _LOCK:
        if _NAV.get("day") == key and _NAV.get("nav"):
            return _NAV["nav"]
    from zgiis.live.broadcast_ephemeris import fetch_gps_nav

    nav = fetch_gps_nav(datetime(day.year, day.month, day.day, 22, tzinfo=timezone.utc))
    with _LOCK:
        _NAV["day"] = key
        _NAV["nav"] = nav
    return nav


def _worker() -> None:
    _load_disk_cache()
    while True:
        try:
            rows = catalog()
            day = latest_rinex_day()
            if not rows or day is None:
                time.sleep(60)
                continue
            day_key = day.isoformat()
            pending = []
            with _LOCK:
                for row in rows:
                    saved = _TEC.get(row["code"]) or {}
                    same_day = saved.get("day") == day_key
                    needs_gg = saved.get("vtec") is not None and "gg_vtec" not in saved
                    if not same_day or needs_gg:
                        pending.append(row)
            if not pending:
                time.sleep(600)
                continue
            nav_by_sv = _nav_for_day(day)
            station = pending[0]
            code = station["code"]
            try:
                summary = compute_station_vtec(code, day, nav_by_sv)
            except Exception as exc:
                log.warning("TrigNet TEC failed for %s: %s", code, exc)
                summary = None
            with _LOCK:
                _TEC[code] = {
                    "day": day_key,
                    "vtec": None if summary is None else summary["vtec"],
                    "gg_vtec": None if summary is None else summary.get("gg_vtec"),
                    "time": None if summary is None else summary["time"],
                    "samples": 0 if summary is None else summary["samples"],
                    "gg_samples": 0 if summary is None else summary.get("gg_samples") or 0,
                }
            _save_disk_cache(day_key)
            if summary is not None:
                log.info(
                    "TrigNet %s G %.2f Gg %s TECU at %s",
                    code,
                    summary["vtec"],
                    summary.get("gg_vtec"),
                    summary["time"],
                )
        except Exception:
            log.exception("TrigNet worker iteration failed")
            time.sleep(30)
        time.sleep(3)


def sample_matches_live_time(sample_time: str | None, now: datetime | None = None) -> bool:
    """True when a TEC sample is within the live window, not an earlier file hour."""
    if not sample_time:
        return False
    text = sample_time.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return False
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return abs(current - parsed) <= LIVE_TIME_MATCH


def start_trignet_tec() -> None:
    """Background GOPI pass over the latest public TrigNet day. One station at a time."""
    if os.getenv("VERCEL"):
        return  # Includes startup warmup, not just the public status route.
    global _STARTED
    with _LOCK:
        if _STARTED:
            return
        _STARTED = True
    threading.Thread(target=_worker, daemon=True, name="trignet-tec").start()
    threading.Thread(target=_start_live_streams, daemon=True, name="trignet-live").start()
    threading.Thread(target=_publish_live_status, daemon=True, name="trignet-publish").start()
    from zgiis.cors.west_africa import start as start_west_africa
    start_west_africa()
    from zgiis.cors.earthscope import start as start_earthscope
    start_earthscope()
    from zgiis.cors.magnetic_equator import start as start_magnetic_equator
    start_magnetic_equator()


def _publish_live_status() -> None:
    from zgiis.cors.trignet_store import save_snapshot

    while True:
        try:
            payload = status()
            if payload.get("stations"):
                save_snapshot(payload)
        except Exception:
            log.warning("TrigNet snapshot publishing failed")
        time.sleep(20)


def _connect_live_archive(pipeline) -> None:
    """Database outages must not prevent the caster from streaming observations."""
    from zgiis.db.timescale import TecDB

    while True:
        try:
            db = TecDB()
        except Exception:
            log.warning("Live TEC archive unavailable; streams continue, retrying in 30 seconds")
            time.sleep(30)
            continue
        pipeline.set_database(db)
        log.info("Live TEC archive connected")
        return


def _start_live_streams() -> None:
    """Use the separate SANSA account for actual RTCM observations."""
    global _LIVE_MANAGER, _LIVE_PIPELINE, _PYTECGG
    configured = _configured_caster()
    if not configured:
        return
    from zgiis.live.ntrip_stream import LiveNtripManager
    from zgiis.live.satellite_geometry import LiveNavCache
    from zgiis.live.stec_vtec import LiveVtecPipeline
    from zgiis.live.broadcast_ephemeris import start_refresh_thread
    from zgiis.live.pytecgg_service import register_network, calibration_session_seconds

    while _LIVE_MANAGER is None:
        try:
            rows = parse_sourcetable(_fetch_sourcetable_text(**configured))
            selected = {x.strip().upper() for x in os.getenv("TRIGNET_NTRIP_MOUNTPOINTS", "").split(",") if x.strip()}
            rows = [r for r in rows if r["country"] == "ZAF" and (not selected or r["code"] in selected or r["mountpoint"].upper() in selected)]
            if not rows:
                raise ValueError("No South African observation mounts available")
            nav = LiveNavCache()
            for row in rows:
                nav.set_receiver_location(row["code"], row["lat"], row["lon"])
            # Persist raw observations so the shared daily receiver sigma-min
            # estimator can fit each SANSA receiver independently, as in Zimbabwe.
            pipeline = LiveVtecPipeline(nav_cache=nav, db_flush_n=5)
            _PYTECGG = register_network("sansa", rows)
            def on_observation(obs):
                _PYTECGG.ingest(obs)
                pipeline.ingest(obs)
            manager = LiveNtripManager(
                configured, on_observation=on_observation, nav_cache=nav,
                max_concurrent=max(1, int(os.getenv("TRIGNET_NTRIP_LIVE_MAX_CONCURRENT", "1"))),
                # PyTECGg needs >=30 observations per continuous arc. Two-minute
                # visits cannot provide that at slower caster cadences.
                max_session_s=calibration_session_seconds(os.getenv("TRIGNET_NTRIP_LIVE_SESSION_S")),
            )
            _LIVE_PIPELINE = pipeline
            _LIVE_MANAGER = manager
            manager.start({r["code"].lower(): r["mountpoint"] for r in rows})
            threading.Thread(target=_connect_live_archive, args=(pipeline,),
                             daemon=True, name="trignet-live-archive").start()
            start_refresh_thread(nav, interval_s=3600)
        except Exception:
            log.warning("South Africa live-stream startup failed; retrying in 30 seconds")
            time.sleep(30)


def status() -> dict[str, Any]:
    if os.getenv("VERCEL"):
        from zgiis.cors.trignet_store import load_snapshot

        return load_snapshot() or {
            "source": "TrigNet / SANSA collector", "source_url": SOURCE_URL,
            "caster": "", "rinex_day": None, "station_count": 0, "tec_ready": 0,
            "gg_ready": 0, "stations": [], "note": "Waiting for the South African collector snapshot.",
        }
    start_trignet_tec()
    rows = catalog()
    # Site discovery must not wait for a slow FTP directory listing. The worker
    # refreshes the RINEX day independently from the map response.
    with _LOCK:
        day = _DAY["day"]
    day_key = day.isoformat() if day else None
    stations = []
    ready = 0
    gg_ready = 0
    with _LOCK:
        tec = dict(_TEC)
    links = _LIVE_MANAGER.status() if _LIVE_MANAGER is not None else {}
    # Use the same station consensus / display-quality rules as Zimbabwe.
    # Keep the less restrictive raw-code summary as diagnostics, not mapped G.
    live_values = _LIVE_PIPELINE.latest_by_station(max_age_s=600) if _LIVE_PIPELINE is not None else {}
    raw_values = _LIVE_PIPELINE.latest_by_station(max_age_s=600, regional=True) if _LIVE_PIPELINE is not None else {}
    diagnostics = _LIVE_PIPELINE.diagnostics_by_station() if _LIVE_PIPELINE is not None else {}
    from zgiis.live.pytecgg_service import snapshot as pytecgg_snapshot
    gg_networks = pytecgg_snapshot()
    for row in rows:
        saved = tec.get(row["code"]) or {}
        key = row["code"].lower()
        link = links.get(key) or {}
        last_rtcm = link.get("last_rtcm_at")
        streaming = bool(last_rtcm and (datetime.now(timezone.utc) - last_rtcm).total_seconds() < 90)
        live_value = live_values.get(key)
        # Gg has its own fit/quality checks. A withheld uncalibrated G value
        # must not prevent calibration of otherwise valid receiver arcs.
        if live_value is not None or key in raw_values:
            saved = {"vtec": live_value,
                     "time": diagnostics.get(key, {}).get("last_vtec_at"), "day": day_key,
                     "samples": diagnostics.get(key, {}).get("vtec_emitted", 0)}
        same_time = sample_matches_live_time(saved.get("time") if saved.get("day") == day_key else None)
        fresh = same_time and saved.get("vtec") is not None
        # Legacy sample-median fits are never advertised as PyTECGg results.
        gg_result = gg_networks.get("sansa", {}).get(key, {})
        gg_value = gg_result.get("gg_vtec")
        if fresh:
            ready += 1
        if isinstance(gg_value, (int, float)) and gg_value == gg_value and gg_value > 0:
            gg_ready += 1
        else:
            gg_value = None
        stations.append({
            **row,
            "connected": bool(link.get("connected")),
            "streaming": streaming,
            "stream_configured": key in links,
            "message_count": link.get("rtcm_count", link.get("msg_count", 0)),
            "tec_diagnostics": diagnostics.get(key, {}),
            "raw_code_vtec": raw_values.get(key),
            "raw_code_vtec_time": (
                diagnostics.get(key, {}).get("last_code_vtec_at")
                or diagnostics.get(key, {}).get("last_vtec_at")
            ) if key in raw_values else None,
            "tec_status": "quality_screened_uncalibrated" if live_value is not None else "withheld_by_shared_quality_rules" if key in raw_values else "awaiting_measurements",
            "tec_method": "gopi_code_vtec_uncalibrated" if live_value is not None else None,
            "tec_quality": "provisional_no_dcb" if live_value is not None else None,
            "vtec": saved.get("vtec") if fresh else None,
            "gg_vtec": gg_value,
            "gg_status": gg_result.get("gg_status", "awaiting_pytecgg_observations"),
            "gg_engine": "pytecgg",
            "gg_version": "1.3.0",
            "gg_time": gg_result.get("gg_time") if gg_value is not None else None,
            "gg_veq": gg_result.get("gg_veq") if gg_value is not None else None,
            "gg_input_epochs": gg_result.get("gg_input_epochs", 0),
            "gg_input_signals": gg_result.get("gg_input_signals", []),
            "vtec_time": saved.get("time") if fresh else None,
            "samples": saved.get("samples") if fresh else 0,
            "gg_samples": gg_result.get("gg_samples", 0) if gg_value is not None else 0,
        })
    from zgiis.cors.west_africa import status as west_africa_status
    from zgiis.cors.earthscope import status as earthscope_status
    from zgiis.cors.magnetic_equator import status as magnetic_equator_status
    regional = west_africa_status(gg_networks) + earthscope_status(gg_networks) + magnetic_equator_status(gg_networks)
    stations.extend(row for row in regional if row["location_known"])
    ready += sum(row["vtec"] is not None for row in regional)
    gg_ready += sum(row["gg_vtec"] is not None for row in regional)
    note = (
        "South African single-base CORS from TrigNet and the configured SANSA caster. "
        "G is GOPI code TEC. Gg is PyTECGg 1.3.0 on raw GPS code/phase observations with navigation. "
        "A value is shown only when it is within 30 minutes of the live Zimbabwe time. "
        "No fresh TEC sample does not establish that a station is offline."
        " SANSA and Zimbabwe share the code-TEC equations, 350 km thin shell, 30-degree elevation mask and station quality rules. "
        "The existing Zimbabwe display rules include a 55 TECU ceiling; this is not proof that larger raw estimates are physically impossible. "
        "Raw SANSA estimates remain available separately for verification; "
        "G remains uncorrected code TEC. Gg follows the notebook's 350 km shell, 20-degree mask, "
        "degree-3 polynomial, batch_size_epochs=30 and package arc detection, shared with Zimbabwe Gg. "
        "Live observations are archived for the shared daily receiver-bias estimator; values are provisional. "
        "Recent measurements are retained for up to 10 minutes during stream rotation."
    )
    configured = _configured_caster()
    casters = [f"{CASTER_HOST}:{CASTER_PORT}"]
    if configured:
        casters.append(f"{configured['host']}:{configured['port']}")
    return {
        "source": "TrigNet / National Geo-spatial Information",
        "source_url": SOURCE_URL,
        "caster": ", ".join(casters),
        "rinex_day": day_key,
        "station_count": len(stations),
        "tec_ready": ready,
        "gg_ready": gg_ready,
        "pytecgg_networks": gg_networks,
        "note": note,
        "stations": stations,
        "unlocated_stations": [row for row in regional if not row["location_known"]],
    }
