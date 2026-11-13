"""Write RINEX 3.04 observation files from georinex xarray datasets."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import re


def _pad(line: str, width: int = 60) -> str:
    return (line[:width]).ljust(width)


def _header_line(label: str, value: str) -> str:
    return _pad(value) + label[:20].ljust(20)


def write_rinex3_obs(
    dataset,
    out_path: Path | str,
    *,
    observer: str = "",
    agency: str = "",
    extra_header: str = "",
    include_doppler: bool = True,
    include_snr: bool = True,
    include_l2c: bool = True,
    systems: str = "all",
) -> Path:
    """Export a georinex observation Dataset to a minimal RINEX 3.04 .obs file."""
    out_path = Path(out_path)
    df = dataset.to_dataframe().reset_index()
    if "time" not in df.columns:
        raise ValueError("Dataset has no time dimension")

    df["time"] = pd.to_datetime(df["time"])
    if systems.lower() != "all" and "sv" in df.columns:
        prefix = {"gps": "G", "glonass": "R", "galileo": "E", "beidou": "C", "qzss": "J", "sbas": "S"}.get(systems.lower(), systems[0].upper())
        df = df[df["sv"].astype(str).str.startswith(prefix)].copy()

    obs_cols = [c for c in df.columns if re.fullmatch(r"[CLDSP]\d[A-Z]?", c)]
    if not include_doppler:
        obs_cols = [c for c in obs_cols if not c.upper().startswith("D")]
    if not include_snr:
        obs_cols = [c for c in obs_cols if not c.upper().startswith("S")]
    if not include_l2c:
        obs_cols = [c for c in obs_cols if c not in ("C2C", "L2C", "S2C", "D2C")]
    obs_cols = sorted(obs_cols)
    if df.empty:
        raise ValueError("No observations for the selected satellite system")
    per_system = {}
    for system, group in df.groupby(df["sv"].astype(str).str[0]):
        codes = {}
        for col in sorted(obs_cols, key=lambda item: -len(item)):
            if not group[col].notna().any():
                continue
            if len(col) == 3:
                target = col
            else:
                target = ("C" if col.startswith("P") else col[0]) + col[1]
                target += "P" if col.startswith("P") or (col[1] == "2" and "P2" in group and group["P2"].notna().any()) else "C"
            codes.setdefault(target, col)
        if codes:
            per_system[system] = codes
    if not per_system:
        raise ValueError("No supported observation fields to write")

    pos = getattr(dataset, "position", None)
    if pos is None:
        pos = dataset.attrs.get("position") if hasattr(dataset, "attrs") else None
    pos_str = ""
    if pos is not None:
        arr = np.asarray(pos, dtype=float).ravel()
        if arr.size >= 3:
            pos_str = f"{arr[0]:14.4f}{arr[1]:14.4f}{arr[2]:14.4f}"

    lines: list[str] = [
        _header_line("RINEX VERSION / TYPE", "     3.04           OBSERVATION DATA    M"),
        _header_line("PGM / RUN BY / DATE", f"{'ZGIIS RINEX CONV':20}{'ZINGSA':20}{datetime.now(timezone.utc):%Y%m%d %H%M%S} UTC"),
        _header_line("MARKER NAME", out_path.stem[:20]),
        _header_line("MARKER TYPE", "GEODETIC"),
        _header_line("OBSERVER / AGENCY", f"{observer[:20]}/{agency[:20]}".strip("/")),
        _header_line("REC # / TYPE / VERS", "0000000 ZGIIS CONV 1.0"),
        _header_line("ANT # / TYPE", "0000000 UNKNOWN"),
        _header_line("APPROX POSITION XYZ", pos_str or f"{0:14.4f}" * 3),
        _header_line("ANTENNA: DELTA H/E/N", f"{0:14.4f}" * 3),
    ]
    if extra_header.strip():
        for hl in extra_header.strip().splitlines():
            lines.append(_header_line("COMMENT", hl))
    if any(len(col) == 2 for col in obs_cols):
        lines.append(_header_line("COMMENT", "Legacy observation codes mapped to explicit RINEX 3 signals."))
    for system, codes in per_system.items():
        names = list(codes)
        for index in range(0, len(names), 13):
            prefix = f"{system}  {len(names):3d}" if index == 0 else f"{system}     "
            lines.append(_header_line("SYS / # / OBS TYPES", prefix + "".join(f" {name:3}" for name in names[index:index + 13])))
    first = pd.Timestamp(df["time"].min())
    time_system = str(dataset.attrs.get("time_system") or "GPS")[:3]
    first_time = f"{first.year:6d}{first.month:6d}{first.day:6d}{first.hour:6d}{first.minute:6d}{first.second + first.microsecond / 1e6:13.7f}     {time_system}"
    lines.append(_header_line("TIME OF FIRST OBS", first_time))
    lines.append(_header_line("END OF HEADER", ""))

    for epoch, grp in df.groupby("time", sort=True):
        t = pd.Timestamp(epoch)
        grp = grp[grp["sv"].astype(str).str[0].isin(per_system)].copy()
        grp = grp.dropna(subset=obs_cols, how="all")
        svs = grp["sv"].astype(str).tolist() if "sv" in grp.columns else []
        lines.append(
            f"> {t.year:4d} {t.month:02d} {t.day:02d} "
            f"{t.hour:02d} {t.minute:02d} {t.second + t.microsecond / 1e6 + t.nanosecond / 1e9:010.7f}  "
            f"0 {len(svs):2d}"
        )
        for _, row in grp.iterrows():
            sv = str(row.get("sv", "G01"))
            parts = [f"{sv:>3}"]
            for col in per_system[sv[0]].values():
                val = row.get(col)
                if val is None or (isinstance(val, float) and not np.isfinite(val)):
                    parts.append("".rjust(16))
                else:
                    parts.append(f"{float(val):14.3f}  ")
            lines.append("".join(parts))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines) + "\n", encoding="ascii", errors="replace")
    return out_path
