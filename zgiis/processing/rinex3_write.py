"""Write RINEX 3.04 observation files from georinex xarray datasets."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


def _pad(line: str, width: int = 60) -> str:
    return (line[:width]).ljust(width)


def _header_line(label: str, value: str) -> str:
    return _pad(f"{label:<20}{value}")


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
        prefix = systems[0].upper()
        df = df[df["sv"].astype(str).str.startswith(prefix)].copy()

    obs_cols = [c for c in df.columns if c not in ("time", "sv") and not c.startswith("dim_")]
    if not include_doppler:
        obs_cols = [c for c in obs_cols if not c.upper().startswith("D")]
    if not include_snr:
        obs_cols = [c for c in obs_cols if not c.upper().startswith("S")]
    if not include_l2c:
        obs_cols = [c for c in obs_cols if c not in ("C2C", "L2C", "S2C", "D2C")]
    obs_cols = sorted(obs_cols)

    pos = getattr(dataset, "position", None)
    if pos is None:
        pos = dataset.attrs.get("position") if hasattr(dataset, "attrs") else None
    pos_str = ""
    if pos is not None:
        arr = np.asarray(pos, dtype=float).ravel()
        if arr.size >= 3:
            pos_str = f"{arr[0]:14.4f}{arr[1]:14.4f}{arr[2]:14.4f}"

    lines: list[str] = [
        _pad("     3.04           OBSERVATION DATA    M                   RINEX VERSION / TYPE"),
        _pad("ZGIIS RINEX CONV  ZINGSA              {:%Y%m%d %H%M%S UTC}".format(datetime.now(timezone.utc))),
        _pad(""),
        _header_line("MARKER NAME", out_path.stem[:20]),
        _header_line("MARKER TYPE", "GEODETIC"),
        _header_line("OBSERVER / AGENCY", f"{observer[:20]}/{agency[:20]}".strip("/")),
        _header_line("REC # / TYPE / VERS", "0000000 ZGIIS CONV 1.0"),
        _header_line("ANT # / TYPE", "0000000 UNKNOWN"),
        _header_line("APPROX POSITION XYZ", pos_str or "0.0 0.0 0.0"),
        _header_line("ANTENNA: DELTA H/E/N", "0.0 0.0 0.0"),
    ]
    if extra_header.strip():
        for hl in extra_header.strip().splitlines():
            lines.append(_pad(hl[:60]))
    lines.append(_pad(f"{' '.join(obs_cols):<60}SYS / # / OBS TYPES"))
    lines.append(_pad("G    7 C1C L1C D1C S1C C2W L2W S2W      SYS / # / OBS TYPES"))
    lines.append(_pad("                                                            END OF HEADER"))

    for epoch, grp in df.groupby("time", sort=True):
        t = pd.Timestamp(epoch)
        svs = grp["sv"].astype(str).tolist() if "sv" in grp.columns else []
        lines.append(
            f"> {t.year:4d} {t.month:02d} {t.day:02d} "
            f"{t.hour:02d} {t.minute:02d} {t.second:02d}.{int(t.microsecond/1000):03d}0000  "
            f"0 {len(svs):2d}"
        )
        for _, row in grp.iterrows():
            sv = str(row.get("sv", "G01"))
            parts = [f"{sv:>3}"]
            for col in obs_cols:
                val = row.get(col)
                if val is None or (isinstance(val, float) and not np.isfinite(val)):
                    parts.append("".rjust(14))
                else:
                    parts.append(f"{float(val):14.3f}")
            lines.append("".join(parts))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines) + "\n", encoding="ascii", errors="replace")
    return out_path
