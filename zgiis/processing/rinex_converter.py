"""RINEX conversion — GOP-style settings applied to MDB/RINEX inputs."""
from __future__ import annotations

import io
import json
import logging
import shutil
import subprocess
import zipfile
from dataclasses import dataclass, fields
from pathlib import Path
from typing import Any

import pandas as pd

log = logging.getLogger("zgiis.rinex_converter")

RINEX_EXTS = {".o", ".obs", ".rnx", ".24o", ".25o", ".26o", ".o.gz", ".obs.gz"}
NAV_EXTS = {".n", ".nav", ".24n", ".25n", ".26n", ".g", ".gnav"}
RAW_EXTS = {".mdb", ".dat", ".tgd", ".t02", ".t04", ".bin"}


@dataclass
class RinexConvertConfig:
    product_type: str = "rinex3"
    observation_rate: str = "original"
    archive_type: str = "none"
    use_multiple_extensions: bool = False
    include_observations: bool = True
    include_observables: str = "all_freq_code_phase"
    satellite_system: str = "all"
    product_dynamics: str = "static"
    compact_rinex: bool = False
    include_doppler: bool = True
    include_snr: bool = True
    include_l2c: bool = True
    include_navigation: bool = True
    observer: str = ""
    agency: str = ""
    include_meteo: bool = False
    meteo_device_name: str = ""
    meteo_manufacturer: str = ""
    include_auxiliary: bool = False
    aux_device_name: str = ""
    aux_manufacturer: str = ""
    general_header: str = ""
    obs_header: str = ""
    nav_header: str = ""
    meteo_header: str = ""
    aux_header: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RinexConvertConfig":
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in known})


@dataclass
class ConvertResult:
    input_name: str
    output_name: str | None
    ok: bool
    message: str


def _try_external_convert(src: Path, dst: Path) -> bool:
    """Try teqc or gfzrnx when installed (common for MDB/raw on GOP workstations)."""
    for cmd, args in (
        ("teqc", [str(src), "+nav", str(dst.with_suffix(".n")), str(dst)]),
        ("gfzrnx", ["-finp", str(src), "-fout", str(dst), "-vo", "3"]),
    ):
        if not shutil.which(cmd):
            continue
        try:
            subprocess.run(args, check=True, capture_output=True, timeout=300)
            if dst.exists():
                return True
        except Exception as exc:
            log.warning("%s failed for %s: %s", cmd, src.name, exc)
    return False


def _resample_dataset(dataset, rate: str):
    if rate == "original":
        return dataset
    import xarray as xr

    df = dataset.to_dataframe().reset_index()
    if "time" not in df.columns:
        return dataset
    df["time"] = pd.to_datetime(df["time"])
    rule = {"1hz": "1s", "30s": "30s", "15s": "15s"}.get(rate)
    if not rule:
        return dataset
    df = df.set_index("time").groupby("sv", group_keys=False).resample(rule).nearest().reset_index()
    return xr.Dataset.from_dataframe(df.set_index(["time", "sv"]))


def _convert_rinex_obs(src: Path, out_dir: Path, cfg: RinexConvertConfig) -> Path:
    import contextlib

    import georinex as gr

    from zgiis.processing.rinex3_write import write_rinex3_obs

    _buf = io.StringIO()
    with contextlib.redirect_stderr(_buf), contextlib.redirect_stdout(_buf):
        ds = gr.load(str(src))
    if isinstance(ds, dict):
        import xarray as xr

        ds = xr.merge(ds.values())
    ds = _resample_dataset(ds, cfg.observation_rate)
    suffix = ".obs" if cfg.product_type == "rinex3" else ".o"
    out = out_dir / f"{src.stem}_conv{suffix}"
    extra = "\n".join(x for x in (cfg.general_header, cfg.obs_header) if x.strip())
    write_rinex3_obs(
        ds,
        out,
        observer=cfg.observer,
        agency=cfg.agency,
        extra_header=extra,
        include_doppler=cfg.include_doppler,
        include_snr=cfg.include_snr,
        include_l2c=cfg.include_l2c,
        systems=cfg.satellite_system,
    )
    return out


def _copy_nav(src: Path, out_dir: Path, cfg: RinexConvertConfig) -> Path:
    out = out_dir / f"{src.stem}_conv{src.suffix}"
    header = cfg.nav_header or cfg.general_header
    if header.strip():
        text = src.read_text(encoding="ascii", errors="replace")
        lines = text.splitlines()
        end_idx = next((i for i, l in enumerate(lines) if "END OF HEADER" in l), -1)
        if end_idx >= 0:
            injected = [header.strip(), *lines[: end_idx + 1]]
            out.write_text("\n".join(injected) + "\n", encoding="ascii", errors="replace")
            return out
    shutil.copy2(src, out)
    return out


def convert_inputs(
    input_paths: list[Path],
    out_dir: Path,
    cfg: RinexConvertConfig,
) -> list[ConvertResult]:
    out_dir.mkdir(parents=True, exist_ok=True)
    results: list[ConvertResult] = []

    for src in input_paths:
        ext = src.suffix.lower()
        try:
            if ext in RINEX_EXTS or ext.replace(".gz", "") in {".o", ".obs", ".rnx"}:
                if not cfg.include_observations:
                    results.append(ConvertResult(src.name, None, True, "skipped (observations off)"))
                    continue
                out = _convert_rinex_obs(src, out_dir, cfg)
                results.append(ConvertResult(src.name, out.name, True, "converted observation file"))
            elif ext in NAV_EXTS:
                if not cfg.include_navigation:
                    results.append(ConvertResult(src.name, None, True, "skipped (navigation off)"))
                    continue
                out = _copy_nav(src, out_dir, cfg)
                results.append(ConvertResult(src.name, out.name, True, "copied navigation file"))
            elif ext in RAW_EXTS:
                dst = out_dir / f"{src.stem}.obs"
                if _try_external_convert(src, dst):
                    results.append(ConvertResult(src.name, dst.name, True, "converted via teqc/gfzrnx"))
                else:
                    results.append(
                        ConvertResult(
                            src.name,
                            None,
                            False,
                            "MDB/raw conversion requires teqc or gfzrnx on the server. "
                            "Install GOP/teqc on the host or upload RINEX .o/.obs files.",
                        ),
                    )
            else:
                results.append(ConvertResult(src.name, None, False, f"unsupported extension {ext}"))
        except Exception as exc:
            log.exception("convert failed for %s", src.name)
            results.append(ConvertResult(src.name, None, False, str(exc)))

    return results


def build_zip(out_dir: Path, results: list[ConvertResult]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        manifest = [{"input": r.input_name, "output": r.output_name, "ok": r.ok, "message": r.message} for r in results]
        zf.writestr("conversion_log.json", json.dumps(manifest, indent=2))
        for path in out_dir.iterdir():
            if path.is_file():
                zf.write(path, arcname=path.name)
    return buf.getvalue()
