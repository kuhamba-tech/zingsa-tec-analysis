"""Strict TOA5/CSV parser preserving original field metadata and polarity."""
from __future__ import annotations
import csv
import io
import math
from typing import Any
from zgiis.gic.quality import canonical_record

_TIME = ("timestamp", "time", "datetime", "date_time", "ts")
_GIC = ("gic_a", "gic_avg", "gic_amps", "gic_amps_avg", "current_a", "neutral_current", "gic")


def parse_gic_file(content: bytes, filename: str, station_id: str, *, logger_timezone: str | None = None,
                   units: str | None = None, calibration_id: str | None = None) -> list[dict[str, Any]]:
    text = content.decode("utf-8-sig", errors="strict")
    lines = list(csv.reader(io.StringIO(text)))
    if not lines:
        raise ValueError("File is empty")
    toa5 = bool(lines[0] and lines[0][0] == "TOA5")
    if toa5 and len(lines) < 5:
        raise ValueError("TOA5 file has no measurements")
    header = [h.strip() for h in lines[1 if toa5 else 0]]
    lowered = {h.lower(): h for h in header}
    def column(aliases):
        return next((lowered[key] for key in aliases if key in lowered), None)
    time_key, current_key = column(_TIME), column(_GIC)
    if not time_key or not current_key:
        raise ValueError("Explicit TIMESTAMP and GIC_A (or GIC_Avg) columns are required")
    file_units = lines[2][header.index(current_key)].strip() if toa5 else None
    declared_units = file_units or units or ("A" if current_key.lower() in {"gic_a", "gic_amps", "gic_amps_avg", "current_a"} else None)
    if declared_units not in {"A", "Amps", "amps", "amperes"}:
        raise ValueError("Current units must explicitly be amperes; supply calibrated GIC, not sensor voltage")
    if units and file_units and units != file_units:
        raise ValueError("Declared units conflict with TOA5 units")
    result = []
    for number, cells in enumerate(lines[4 if toa5 else 1:], start=5 if toa5 else 2):
        if not cells or not any(cells):
            continue
        if len(cells) != len(header):
            raise ValueError(f"Row {number}: column count differs from header")
        raw = dict(zip(header, cells))
        try:
            flags_key = column(("quality_flags", "quality", "qc"))
            flags = [v.strip() for v in raw.get(flags_key, "").split(";") if v.strip() and v.strip().lower() not in {"good", "valid", "0"}]
            record = {"time": raw[time_key], "station_id": station_id,
                      "gic_a": float(raw[current_key]), "units": "A", "source": f"upload:{filename}",
                      "logger_timezone": logger_timezone, "calibration_id": calibration_id,
                      "quality_flags": flags, "raw_fields": raw,
                      "toa5_headers": lines[:4] if toa5 else None}
            for target, aliases in {"temp_c": ("temp_c", "ptemp_c", "temperature"),
                                    "bx_nt": ("bx_nt",), "by_nt": ("by_nt",), "bz_nt": ("bz_nt",),
                                    "clock_offset_seconds": ("clock_offset_seconds",)}.items():
                field = column(aliases)
                if field and raw[field].strip():
                    record[target] = float(raw[field])
            result.append(canonical_record(record))
        except (ValueError, TypeError, KeyError) as exc:
            raise ValueError(f"Row {number}: {exc}") from exc
    if not result:
        raise ValueError("No field measurements in file")
    return sorted(result, key=lambda row: row["time"])
