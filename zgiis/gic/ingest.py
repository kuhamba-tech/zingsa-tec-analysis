"""Parsers for GIC field data files.

Supported formats:
- Campbell Scientific CR1000 TOA5 files (the datalogger used at the
  ZINGSA/ZETDC monitoring stations),
- generic CSV with a timestamp column and a GIC current column.

Only rows with a parseable timestamp and numeric current value are kept.
"""
from __future__ import annotations

import csv
import io
from typing import Any

import pandas as pd

_TIME_ALIASES = ("timestamp", "time", "datetime", "date_time", "ts", "date")
_GIC_ALIASES = ("gic_a", "gic", "gic_amps", "current_a", "current", "neutral_current", "amps", "dc_current")
_TEMP_ALIASES = ("temp_c", "temperature", "temp", "ptemp_c", "panel_temp")


def _find_column(columns: list[str], aliases: tuple[str, ...]) -> str | None:
    lowered = {c.lower().strip(): c for c in columns}
    for alias in aliases:
        if alias in lowered:
            return lowered[alias]
    # Substring match as a fallback (e.g. "GIC_Avg", "GIC_Amps_Avg").
    for key, original in lowered.items():
        if any(alias in key for alias in aliases):
            return original
    return None


def parse_gic_file(content: bytes, filename: str, station_id: str) -> list[dict[str, Any]]:
    """Parse a TOA5 or CSV file into gic_log rows. Raises ValueError if unusable."""
    text = content.decode("utf-8", errors="replace")
    if not text.strip():
        raise ValueError("File is empty.")

    first_line = text.splitlines()[0]
    if first_line.startswith('"TOA5"') or first_line.startswith("TOA5"):
        return _parse_toa5(text, station_id, filename)
    return _parse_csv(text, station_id, filename)


def _parse_toa5(text: str, station_id: str, filename: str) -> list[dict[str, Any]]:
    """Campbell TOA5: 4 header lines (env, field names, units, aggregation)."""
    lines = text.splitlines()
    if len(lines) < 5:
        raise ValueError("TOA5 file has no data rows.")
    header = next(csv.reader([lines[1]]))
    data_text = "\n".join(lines[4:])
    df = pd.read_csv(io.StringIO(data_text), names=header, na_values=["NAN", '"NAN"'])
    return _rows_from_dataframe(df, station_id, f"upload:{filename}")


def _parse_csv(text: str, station_id: str, filename: str) -> list[dict[str, Any]]:
    df = pd.read_csv(io.StringIO(text))
    return _rows_from_dataframe(df, station_id, f"upload:{filename}")


def _rows_from_dataframe(df: pd.DataFrame, station_id: str, source: str) -> list[dict[str, Any]]:
    columns = [str(c) for c in df.columns]
    time_col = _find_column(columns, _TIME_ALIASES)
    gic_col = _find_column(columns, _GIC_ALIASES)
    temp_col = _find_column(columns, _TEMP_ALIASES)

    if not time_col or not gic_col:
        raise ValueError(
            "Could not find timestamp and GIC current columns. "
            f"Found columns: {', '.join(columns)}. Expected e.g. TIMESTAMP + GIC_A."
        )

    times = pd.to_datetime(df[time_col], utc=True, errors="coerce")
    currents = pd.to_numeric(df[gic_col], errors="coerce")
    temps = pd.to_numeric(df[temp_col], errors="coerce") if temp_col else None

    rows: list[dict[str, Any]] = []
    for i in range(len(df)):
        t = times.iloc[i]
        v = currents.iloc[i]
        if pd.isna(t) or pd.isna(v):
            continue
        temp_v = None
        if temps is not None and not pd.isna(temps.iloc[i]):
            temp_v = round(float(temps.iloc[i]), 2)
        rows.append(
            {
                "time": t.isoformat(),
                "station_id": station_id.upper(),
                "gic_a": round(float(v), 4),
                "temp_c": temp_v,
                "source": source,
            }
        )

    if not rows:
        raise ValueError("No valid measurement rows found in the file.")
    return rows
