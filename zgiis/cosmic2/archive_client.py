"""Real download + local cache for UCAR/CDAAC COSMIC-2 daily ionPrf tarballs.

Extends zgiis/space_weather/cosmic2_client.py's existence-check-only pattern
(same URL convention, verified against the real archive: a day's tarball is
level2/YYYY/DDD/ionPrf_prov1_YYYY_DDD.tar.gz) with an actual download,
checksum-verified cache reuse, and extraction step. That module is left
untouched — it still backs the existing coverage-check endpoint.
"""
from __future__ import annotations

import hashlib
import logging
import tarfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import requests

log = logging.getLogger(__name__)

BASE_URL = "https://data.cosmic.ucar.edu/gnss-ro/cosmic2/provisional/spaceWeather"
LEVEL2_URL = f"{BASE_URL}/level2"

CACHE_ROOT = Path(__file__).resolve().parents[2] / "static" / "data" / "cosmic2_cache"
TARBALL_DIR = CACHE_ROOT / "tarballs"
EXTRACT_DIR = CACHE_ROOT / "extracted"

# Confirmed against a real download: the archive's per-profile files use a
# literal "_nc" suffix, not ".nc".
PROFILE_GLOB = "ionPrf_*_nc"


def _file_url(day: date) -> tuple[str, str, int]:
    doy = day.timetuple().tm_yday
    doy_s = f"{doy:03d}"
    filename = f"ionPrf_prov1_{day.year}_{doy_s}.tar.gz"
    return f"{LEVEL2_URL}/{day.year}/{doy_s}/{filename}", filename, doy


@dataclass
class DownloadResult:
    day: date
    tarball_path: Path | None
    size_bytes: int | None
    sha256: str | None
    was_cached: bool
    status: str  # "cached" | "downloaded" | "missing" | "error"
    note: str


@dataclass
class ExtractResult:
    day: date
    download: DownloadResult
    extract_dir: Path | None
    profile_files: list[Path]
    status: str  # "ok" | "missing" | "error"
    note: str


def tarball_cache_path(day: date) -> Path:
    _, filename, _ = _file_url(day)
    return TARBALL_DIR / filename


def extract_dir_for_day(day: date) -> Path:
    doy = day.timetuple().tm_yday
    return EXTRACT_DIR / f"{day.year}_{doy:03d}"


def _sha256_of_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _sidecar_path(tarball_path: Path) -> Path:
    return tarball_path.with_suffix(tarball_path.suffix + ".sha256")


def _cached_and_verified(tarball_path: Path) -> str | None:
    """Return the sha256 if a cached tarball + sidecar exist and re-hashing
    the local file matches the sidecar (proves the cached copy isn't a
    truncated/corrupt partial write). UCAR publishes no remote checksum to
    compare against, so this is checksum-verified cache reuse, not
    dedup-before-download against a remote reference."""
    sidecar = _sidecar_path(tarball_path)
    if not tarball_path.exists() or not sidecar.exists():
        return None
    recorded = sidecar.read_text(encoding="ascii").strip()
    actual = _sha256_of_file(tarball_path)
    return actual if actual == recorded else None


def download_daily_tarball(day: date, *, timeout: int = 120, force: bool = False) -> DownloadResult:
    url, filename, _ = _file_url(day)
    TARBALL_DIR.mkdir(parents=True, exist_ok=True)
    tarball_path = TARBALL_DIR / filename

    if not force:
        verified_sha = _cached_and_verified(tarball_path)
        if verified_sha:
            return DownloadResult(
                day=day, tarball_path=tarball_path, size_bytes=tarball_path.stat().st_size,
                sha256=verified_sha, was_cached=True, status="cached", note="Checksum-verified local cache hit.",
            )

    part_path = tarball_path.with_suffix(tarball_path.suffix + ".part")
    try:
        resp = requests.get(url, stream=True, timeout=timeout)
        if resp.status_code != 200:
            return DownloadResult(
                day=day, tarball_path=None, size_bytes=None, sha256=None, was_cached=False,
                status="missing", note=f"UCAR returned HTTP {resp.status_code} for {url}",
            )
        h = hashlib.sha256()
        with part_path.open("wb") as fh:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    fh.write(chunk)
                    h.update(chunk)
        sha = h.hexdigest()
        part_path.replace(tarball_path)
        _sidecar_path(tarball_path).write_text(sha, encoding="ascii")
        return DownloadResult(
            day=day, tarball_path=tarball_path, size_bytes=tarball_path.stat().st_size,
            sha256=sha, was_cached=False, status="downloaded", note="Downloaded from UCAR.",
        )
    except Exception as exc:
        log.warning("COSMIC-2 tarball download failed for %s: %s", day, exc)
        return DownloadResult(
            day=day, tarball_path=None, size_bytes=None, sha256=None, was_cached=False,
            status="error", note=str(exc),
        )
    finally:
        if part_path.exists():
            part_path.unlink(missing_ok=True)


def ensure_extracted(day: date, tarball_path: Path) -> Path:
    extract_dir = extract_dir_for_day(day)
    marker = extract_dir / ".extracted_ok"
    if marker.exists():
        return extract_dir
    extract_dir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tarball_path) as tf:
        tf.extractall(extract_dir, filter="data")
    marker.write_text("ok", encoding="ascii")
    return extract_dir


def list_profile_files(extract_dir: Path) -> list[Path]:
    files = sorted(extract_dir.rglob(PROFILE_GLOB))
    if not files:
        log.warning("No profile files matched %s under %s", PROFILE_GLOB, extract_dir)
    return files


def fetch_and_extract_daily(day: date, *, timeout: int = 120, force: bool = False) -> ExtractResult:
    download = download_daily_tarball(day, timeout=timeout, force=force)
    if download.status in ("missing", "error"):
        return ExtractResult(
            day=day, download=download, extract_dir=None, profile_files=[],
            status="missing" if download.status == "missing" else "error", note=download.note,
        )
    try:
        extract_dir = ensure_extracted(day, download.tarball_path)
        profile_files = list_profile_files(extract_dir)
        return ExtractResult(
            day=day, download=download, extract_dir=extract_dir, profile_files=profile_files,
            status="ok", note=f"{len(profile_files)} profile file(s).",
        )
    except Exception as exc:
        log.warning("COSMIC-2 extraction failed for %s: %s", day, exc)
        return ExtractResult(day=day, download=download, extract_dir=None, profile_files=[], status="error", note=str(exc))
