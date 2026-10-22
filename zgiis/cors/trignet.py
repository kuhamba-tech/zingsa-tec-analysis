"""South African TrigNet CORS: public sourcetable plus GOPI TEC from RINEX.

The caster at 196.15.132.2:2101 publishes the station list without a login.
Observation streams require a TrigNet account, so TEC is computed from the
newest public 30-second daily RINEX on ftp://ftp.trignet.co.za using the same
code-TEC pipeline as Zimbabwe RINEX (``read_rinex_files``). Values keep the
file time. This does not open the Zimbabwe NTRIP caster.
"""
from __future__ import annotations

import ftplib
import json
import logging
import shutil
import socket
import tempfile
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

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


def _fetch_sourcetable_text() -> str:
    request = (
        "GET / HTTP/1.0\r\n"
        "User-Agent: NTRIP ZGIIS/1.0\r\n"
        "Accept: */*\r\n"
        "Connection: close\r\n\r\n"
    )
    sock = socket.create_connection((CASTER_HOST, CASTER_PORT), timeout=20)
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
    finally:
        sock.close()
    return b"".join(chunks).decode("latin1", "replace")


def catalog() -> list[dict[str, Any]]:
    now = time.monotonic()
    with _LOCK:
        cached = _CATALOG["stations"]
        if cached and now - float(_CATALOG["at"]) < _CATALOG_TTL_S:
            return list(cached)
    try:
        rows = parse_sourcetable(_fetch_sourcetable_text())
    except Exception:
        log.warning("TrigNet sourcetable fetch failed", exc_info=True)
        with _LOCK:
            return list(_CATALOG["stations"])
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
    from zgiis.live.stec_vtec import mapping_function, tecg_from_pseudorange

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
                if look is None or look[0] < 30.0:
                    continue
                vtec = tecg_from_pseudorange(p1, p2) / mapping_function(look[0])
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
    global _STARTED
    with _LOCK:
        if _STARTED:
            return
        _STARTED = True
    threading.Thread(target=_worker, daemon=True, name="trignet-tec").start()


def status() -> dict[str, Any]:
    start_trignet_tec()
    rows = catalog()
    day = latest_rinex_day()
    day_key = day.isoformat() if day else None
    stations = []
    ready = 0
    gg_ready = 0
    with _LOCK:
        tec = dict(_TEC)
    for row in rows:
        saved = tec.get(row["code"]) or {}
        same_time = sample_matches_live_time(saved.get("time") if saved.get("day") == day_key else None)
        fresh = same_time and saved.get("vtec") is not None
        gg_value = saved.get("gg_vtec") if same_time else None
        if fresh:
            ready += 1
        if isinstance(gg_value, (int, float)) and gg_value == gg_value and gg_value > 0:
            gg_ready += 1
        else:
            gg_value = None
        stations.append({
            **row,
            "vtec": saved.get("vtec") if fresh else None,
            "gg_vtec": gg_value,
            "vtec_time": saved.get("time") if fresh else None,
            "samples": saved.get("samples") if fresh else 0,
            "gg_samples": saved.get("gg_samples") if gg_value is not None else 0,
        })
    note = (
        "TrigNet single-base CORS from the public NTRIP sourcetable. "
        "G is GOPI code TEC and Gg is Cesaroni calibration on the same samples. "
        "A value is shown only when it is within 30 minutes of the live Zimbabwe time. "
        "Stations with no sample at that time are offline."
    )
    return {
        "source": "TrigNet / National Geo-spatial Information",
        "source_url": SOURCE_URL,
        "caster": f"{CASTER_HOST}:{CASTER_PORT}",
        "rinex_day": day_key,
        "station_count": len(stations),
        "tec_ready": ready,
        "gg_ready": gg_ready,
        "note": note,
        "stations": stations,
    }
