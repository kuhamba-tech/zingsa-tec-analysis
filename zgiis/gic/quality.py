"""Canonical field records and explicit quality rules. No inferred calibration."""
from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pandas as pd


def utc_stamp(value: str, logger_timezone: str | None = None) -> str:
    stamp = pd.Timestamp(value)
    if pd.isna(stamp):
        raise ValueError("Invalid observation timestamp")
    if stamp.tzinfo is None:
        if not logger_timezone:
            raise ValueError("Naive logger timestamp requires an explicit logger_timezone")
        stamp = stamp.tz_localize(ZoneInfo(logger_timezone), ambiguous="raise", nonexistent="raise")
    return stamp.tz_convert("UTC").isoformat()


def canonical_record(row: dict) -> dict:
    sid = str(row.get("station_id", "")).strip().upper()
    if not re.fullmatch(r"[A-Z0-9_\-]{1,64}", sid):
        raise ValueError("Invalid station identifier")
    current = float(row["gic_a"])
    if not math.isfinite(current):
        raise ValueError("GIC current must be finite")
    if row.get("units", "A") != "A":
        raise ValueError("Supply calibrated signed current in amperes; voltage is not current")
    original = str(row.get("original_time") or row["time"])
    stamp = utc_stamp(str(row["time"]), row.get("logger_timezone"))
    flags = list(dict.fromkeys(row.get("quality_flags") or []))
    if pd.Timestamp(stamp).timestamp() > datetime.now(timezone.utc).timestamp() + 300:
        flags.append("future_timestamp")
    for key in ("temp_c", "bx_nt", "by_nt", "bz_nt", "clock_offset_seconds"):
        if row.get(key) is not None and not math.isfinite(float(row[key])):
            raise ValueError(f"{key} must be finite")
    return {**row, "station_id": sid, "time": stamp, "original_time": original,
            "gic_a": current, "units": "A", "quality_flags": list(dict.fromkeys(flags))}


def valid_frame(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df.copy()
    good = pd.to_numeric(df["gic_a"], errors="coerce").map(lambda v: pd.notna(v) and math.isfinite(v))
    if "quality_flags" in df:
        good &= df["quality_flags"].map(lambda flags: not flags)
    if "time" in df:
        good &= pd.to_datetime(df["time"], utc=True) <= pd.Timestamp.now(tz="UTC")
    return df.loc[good].sort_values("time").drop_duplicates(["time", "station_id"] if "station_id" in df else ["time"]).copy()
