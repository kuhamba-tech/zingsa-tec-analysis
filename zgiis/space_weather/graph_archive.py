"""Store dashboard graph series in Supabase and put that history back on the charts.

NOAA's live files only cover the last one to three days, and the previous
chart cache lived in a local SQLite file that disappears on restart. Samples
are written to ``space_weather_timeline`` whenever the collector or the API
is running, then older days are drawn from that table.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

log = logging.getLogger(__name__)

ARCHIVE_HOURS = 24 * 7
_OLDER_POINTS = 240
_LIVE_POINTS = 360
_ARCHIVE_GAP_SEC = 300.0

_PROTON_METRICS = {
    ">=10 MeV": "proton_ge10mev",
    ">=50 MeV": "proton_ge50mev",
    ">=100 MeV": "proton_ge100mev",
    ">=500 MeV": "proton_ge500mev",
}
_PROTON_FIELDS = {metric: energy for energy, metric in _PROTON_METRICS.items()}

_archive_lock = threading.Lock()
_db_lock = threading.Lock()
_last_archive_started = 0.0
_last_prune = 0.0
_db = None
_timeline_write: dict[str, float] = {}
_timeline_read: dict[str, tuple[float, list[tuple[str, float]]]] = {}


def _database():
    global _db
    if _db is None:
        from zgiis.db.space_weather_db import SpaceWeatherDB

        _db = SpaceWeatherDB()
    return _db


def _parse_time(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        stamp = value
    else:
        if not value:
            return None
        try:
            stamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp.astimezone(timezone.utc)


def _iso(stamp: datetime) -> str:
    return stamp.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _label(stamp: datetime) -> str:
    return stamp.astimezone(timezone.utc).strftime("%m-%d %H:%MZ")


def _epoch_ms(stamp: datetime) -> int:
    return int(stamp.timestamp() * 1000)


def _stride(rows: list[dict[str, Any]], max_points: int) -> list[dict[str, Any]]:
    if max_points <= 0 or len(rows) <= max_points:
        return rows
    step = max(1, len(rows) // max_points)
    sampled = rows[::step]
    if sampled[-1] is not rows[-1]:
        sampled.append(rows[-1])
    return sampled


def iter_monitor_rows(payload: dict[str, Any]):
    """Yield (metric, time, value) for one heliospheric monitor payload."""
    panels = (
        ("xray", {"xray_flux": "flux"}),
        ("imf", {"imf_bt": "bt", "imf_by": "by", "imf_bz": "bz"}),
        (
            "solar_wind",
            {
                "solar_wind_speed": "speed",
                "solar_wind_density": "density",
                "solar_wind_temperature": "temperature",
            },
        ),
        ("dst", {"dst": "dst"}),
        (
            "kp",
            {
                "kp_observed": "observed",
                "kp_estimated": "estimated",
                "kp_predicted": "predicted",
            },
        ),
    )
    for panel_name, fields in panels:
        panel = payload.get(panel_name) or {}
        times = panel.get("times") or []
        for index, raw_time in enumerate(times):
            for metric, key in fields.items():
                values = panel.get(key) or []
                if index >= len(values) or values[index] is None:
                    continue
                yield metric, raw_time, values[index]
    protons = payload.get("protons") or {}
    series = protons.get("series") or {}
    for index, raw_time in enumerate(protons.get("times") or []):
        for energy, metric in _PROTON_METRICS.items():
            values = series.get(energy) or []
            if index >= len(values) or values[index] is None:
                continue
            yield metric, raw_time, values[index]


def snapshot_rows(row: dict[str, Any]):
    """One sample of the scalar dashboard graphs, stamped at log time."""
    when = row.get("time")
    fields = {
        "kp": row.get("kp"),
        "dst": row.get("dst"),
        "f107": row.get("f107"),
        "solar_wind": row.get("plasma_speed"),
        "s4": row.get("s4"),
        "gnss_risk": row.get("gnss_risk_score"),
        "stations_online": row.get("stations_online"),
        "mean_vtec": row.get("mean_vtec"),
    }
    for metric, value in fields.items():
        if value is None:
            continue
        yield metric, when, value


def store_rows(rows) -> int:
    payload = list(rows)
    if not payload:
        return 0
    try:
        with _db_lock:
            return _database().upsert_timeline(payload)
    except Exception as exc:
        log.warning("graph archive write failed: %s", exc)
        return 0


def _store_later(rows: list[tuple[Any, Any, Any]]) -> None:
    def run() -> None:
        written = store_rows(rows)
        if written:
            log.info("Archived %d graph sample(s)", written)
        _prune_if_due()

    threading.Thread(target=run, name="graph-archive-write", daemon=True).start()


def _prune_if_due() -> None:
    global _last_prune
    now = time.monotonic()
    if now - _last_prune < 24 * 3600:
        return
    _last_prune = now
    try:
        with _db_lock:
            removed = _database().prune_timeline(days=90)
        if removed:
            log.info("Pruned %d graph sample(s) older than 90 days", removed)
    except Exception as exc:
        log.warning("graph archive prune failed: %s", exc)


def _panel_rows(times: list[Any], arrays: dict[str, list[Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, raw_time in enumerate(times):
        stamp = _parse_time(raw_time)
        if stamp is None:
            continue
        row: dict[str, Any] = {"t": stamp}
        kept = False
        for key, values in arrays.items():
            value = values[index] if index < len(values) else None
            row[key] = value
            kept = kept or value is not None
        if kept:
            rows.append(row)
    rows.sort(key=lambda item: item["t"])
    return rows


def _rows_to_panel(rows: list[dict[str, Any]], keys: list[str]) -> dict[str, Any]:
    stamps = [row["t"] for row in rows]
    panel: dict[str, Any] = {
        "labels": [_label(stamp) for stamp in stamps],
        "times": [_iso(stamp) for stamp in stamps],
        "epoch_ms": [_epoch_ms(stamp) for stamp in stamps],
    }
    for key in keys:
        panel[key] = [row.get(key) for row in rows]
    return panel


def _stored_rows(
    stored: dict[str, list[tuple[datetime, float]]],
    fields: dict[str, str],
) -> list[dict[str, Any]]:
    """Every saved sample, including times the latest live file skipped."""
    by_time: dict[datetime, dict[str, Any]] = {}
    for metric, key in fields.items():
        for stamp, value in stored.get(metric, []):
            row = by_time.setdefault(stamp, {"t": stamp})
            row[key] = value
    return [by_time[stamp] for stamp in sorted(by_time)]


def _merge_panel(
    panel: dict[str, Any],
    fields: dict[str, str],
    stored: dict[str, list[tuple[datetime, float]]],
    *,
    live_points: int,
) -> dict[str, Any]:
    live = _panel_rows(panel.get("times") or [], {key: panel.get(key) or [] for key in fields.values()})
    by_time = {row["t"]: row for row in _stored_rows(stored, fields)}
    for row in live:
        previous = by_time.get(row["t"])
        if previous is None:
            by_time[row["t"]] = row
            continue
        merged_row = dict(previous)
        for key, value in row.items():
            if value is not None:
                merged_row[key] = value
        by_time[row["t"]] = merged_row
    combined = _stride(
        [by_time[stamp] for stamp in sorted(by_time)],
        max(live_points, _LIVE_POINTS),
    )
    rebuilt = _rows_to_panel(combined, list(fields.values()))
    for extra in ("unit",):
        if extra in panel:
            rebuilt[extra] = panel[extra]
    return rebuilt


def extend_monitor_payload(
    payload: dict[str, Any],
    stored: dict[str, list[tuple[datetime, float]]],
) -> dict[str, Any]:
    """Prepend archived days and thin the live window for the chart response."""
    merged = dict(payload)
    merged["xray"] = _merge_panel(
        payload.get("xray") or {},
        {"xray_flux": "flux"},
        stored,
        live_points=_LIVE_POINTS,
    )
    merged["imf"] = _merge_panel(
        payload.get("imf") or {},
        {"imf_bt": "bt", "imf_by": "by", "imf_bz": "bz"},
        stored,
        live_points=_LIVE_POINTS,
    )
    merged["solar_wind"] = _merge_panel(
        payload.get("solar_wind") or {},
        {
            "solar_wind_speed": "speed",
            "solar_wind_density": "density",
            "solar_wind_temperature": "temperature",
        },
        stored,
        live_points=_LIVE_POINTS,
    )
    merged["dst"] = _merge_panel(
        payload.get("dst") or {},
        {"dst": "dst"},
        stored,
        live_points=_LIVE_POINTS,
    )
    merged["kp"] = _merge_panel(
        payload.get("kp") or {},
        {
            "kp_observed": "observed",
            "kp_estimated": "estimated",
            "kp_predicted": "predicted",
        },
        stored,
        live_points=len((payload.get("kp") or {}).get("times") or []) or _LIVE_POINTS,
    )
    observed = merged["kp"].get("observed") or []
    estimated = merged["kp"].get("estimated") or []
    predicted = merged["kp"].get("predicted") or []
    kinds: list[str] = []
    for index in range(len(merged["kp"].get("times") or [])):
        obs = observed[index] if index < len(observed) else None
        est = estimated[index] if index < len(estimated) else None
        pred = predicted[index] if index < len(predicted) else None
        if obs is not None:
            kinds.append("observed")
        elif est is not None:
            kinds.append("estimated")
        elif pred is not None:
            kinds.append("predicted")
        else:
            kinds.append("unknown")
    merged["kp"]["kinds"] = kinds
    protons = payload.get("protons") or {}
    proton_fields = {metric: energy for energy, metric in _PROTON_METRICS.items()}
    # Proton values live under series[energy], so flatten then pack them back.
    flat = {
        "times": protons.get("times") or [],
        **(protons.get("series") or {}),
    }
    rebuilt = _merge_panel(flat, proton_fields, stored, live_points=_LIVE_POINTS)
    merged["protons"] = {
        "labels": rebuilt.get("labels") or [],
        "times": rebuilt.get("times") or [],
        "epoch_ms": rebuilt.get("epoch_ms") or [],
        "series": {energy: rebuilt.get(energy) or [] for energy in _PROTON_METRICS},
        "unit": protons.get("unit") or "pfu",
    }
    return merged


def _read_archive() -> dict[str, list[tuple[datetime, float]]]:
    since = datetime.now(tz=timezone.utc) - timedelta(hours=ARCHIVE_HOURS)
    metrics = [
        "xray_flux",
        "imf_bt",
        "imf_by",
        "imf_bz",
        "solar_wind_speed",
        "solar_wind_density",
        "solar_wind_temperature",
        "dst",
        "kp_observed",
        "kp_estimated",
        "kp_predicted",
        *_PROTON_FIELDS,
    ]
    with _db_lock:
        return _database().read_timeline_bins(metrics, since=since, before=None, bin_minutes=15)


def prepare_monitor_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Save the samples just fetched and overlay up to seven stored days."""
    rows = list(iter_monitor_rows(payload))
    if rows:
        _store_later(rows)
    try:
        stored = _read_archive()
    except Exception as exc:
        log.warning("graph archive read failed: %s", exc)
        stored = {}
    if not stored:
        return extend_monitor_payload(payload, {})
    return extend_monitor_payload(payload, stored)


def remember_timeline(metric: str, points: list[tuple[str, float | None]]) -> list[tuple[str, float]]:
    """Store one chart series and return the saved samples from the last 7 days."""
    now = time.monotonic()
    last_write = _timeline_write.get(metric, 0.0)
    if now - last_write >= 60:
        store_rows((metric, stamp, value) for stamp, value in points if stamp and value is not None)
        _timeline_write[metric] = time.monotonic()
    cached = _timeline_read.get(metric)
    if cached is not None and now - cached[0] < 60:
        return cached[1]
    since = datetime.now(tz=timezone.utc) - timedelta(hours=ARCHIVE_HOURS)
    try:
        with _db_lock:
            bins = _database().read_timeline_bins([metric], since=since, before=None, bin_minutes=15)
    except Exception as exc:
        log.warning("timeline read failed for %s: %s", metric, exc)
        return []
    saved = [(_iso(stamp), value) for stamp, value in bins.get(metric, [])]
    _timeline_read[metric] = (time.monotonic(), saved)
    return saved


def archive_live_graphs_in_background() -> None:
    """Fetch the current NOAA graph files and store them. At most one run at a time."""
    global _last_archive_started
    now = time.monotonic()
    if now - _last_archive_started < _ARCHIVE_GAP_SEC:
        return
    if not _archive_lock.acquire(blocking=False):
        return
    _last_archive_started = now

    def run() -> None:
        try:
            from zgiis.space_weather.heliospheric_monitor import archive_current_graphs

            archive_current_graphs()
        except Exception as exc:
            log.warning("graph archive refresh failed: %s", exc)
        try:
            from zgiis.processing.zimbabwe_scientific_plots import archive_recent_diurnal_hours

            archive_recent_diurnal_hours()
        except Exception as exc:
            log.warning("hourly VTEC log failed: %s", exc)
        try:
            from zgiis.processing.tec_method_hour_log import archive_method_hours

            archive_method_hours()
        except Exception as exc:
            log.warning("method comparison hour log failed: %s", exc)
        try:
            from zgiis.processing.receiver_bias_log import archive_receiver_bias

            archive_receiver_bias()
        except Exception as exc:
            log.warning("receiver bias log failed: %s", exc)
        finally:
            _archive_lock.release()

    threading.Thread(target=run, name="graph-archive", daemon=True).start()
