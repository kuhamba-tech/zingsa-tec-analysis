"""Build a compact hourly TEC index from real processed CMN files."""
from __future__ import annotations

import argparse
import re
from pathlib import Path

import pandas as pd


CMN_COLUMNS = [
    "mjdate",
    "time_hours",
    "prn",
    "az",
    "elevation",
    "lat",
    "lon",
    "stec",
    "vtec",
    "s4",
]


def station_and_date(path: Path) -> tuple[str | None, pd.Timestamp | None]:
    match = re.match(
        r"(?P<station>[A-Za-z0-9_]{4}).*?"
        r"(?P<date>20\d{2}-\d{2}-\d{2})",
        path.stem,
    )
    if not match:
        return None, None
    return (
        match.group("station").lower().rstrip("_"),
        pd.Timestamp(match.group("date")),
    )


def aggregate_file(path: Path, elevation_min: float) -> pd.DataFrame:
    station, date = station_and_date(path)
    if station is None or date is None:
        return pd.DataFrame()

    frame = pd.read_csv(
        path,
        sep=r"\s+",
        engine="python",
        skiprows=3,
        names=CMN_COLUMNS,
        usecols=["time_hours", "elevation", "vtec"],
        comment="#",
    )
    for column in ["time_hours", "elevation", "vtec"]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame.dropna(subset=["time_hours", "elevation", "vtec"])
    frame = frame[frame["elevation"] >= elevation_min].copy()
    if frame.empty:
        return frame

    frame["hour"] = frame["time_hours"].floordiv(1).clip(0, 23).astype(int)
    hourly = (
        frame.groupby("hour", as_index=False)
        .agg(vtec=("vtec", "mean"), observations=("vtec", "size"))
    )
    hourly["timestamp"] = date + pd.to_timedelta(hourly["hour"], unit="h")
    hourly["date"] = date
    hourly["station"] = station
    hourly["source_file"] = path.name
    hourly["constellation"] = "GPS"
    hourly["prn"] = "ALL"
    return hourly[
        [
            "timestamp",
            "date",
            "station",
            "vtec",
            "observations",
            "source_file",
            "constellation",
            "prn",
        ]
    ]


def build_index(source: Path, output: Path, elevation_min: float) -> None:
    files = sorted(
        {
            *source.rglob("*.Cmn"),
            *source.rglob("*.cmn"),
        }
    )
    files = [
        path
        for path in files
        if "zgiis_outputs" not in path.parts
        and "tec_python_outputs" not in path.parts
    ]

    frames = []
    for index, path in enumerate(files, start=1):
        hourly = aggregate_file(path, elevation_min)
        if not hourly.empty:
            frames.append(hourly)
        if index % 25 == 0 or index == len(files):
            print(f"Processed {index}/{len(files)} CMN files")

    if not frames:
        raise RuntimeError(f"No valid CMN observations found under {source}")

    result = pd.concat(frames, ignore_index=True)
    result = (
        result.groupby(
            [
                "timestamp",
                "date",
                "station",
                "source_file",
                "constellation",
                "prn",
            ],
            as_index=False,
        )
        .agg(vtec=("vtec", "mean"), observations=("observations", "sum"))
        .sort_values(["timestamp", "station"])
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(output, index=False)
    print(
        f"Wrote {len(result):,} hourly rows from {len(files)} files "
        f"to {output}"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--elevation-min", type=float, default=30.0)
    args = parser.parse_args()
    build_index(args.source, args.output, args.elevation_min)


if __name__ == "__main__":
    main()
