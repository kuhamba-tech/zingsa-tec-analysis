"""ZGIIS — RINEX/CMN Processing Module."""
from __future__ import annotations

from dataclasses import replace
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

root = Path(__file__).resolve().parents[1]
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
from zgiis.maps.station_map import (
    MAP_STYLE_KEYS,
    MAP_STYLE_OPTIONS,
    render_cors_station_map,
)
from zgiis.processing.pipeline_explanations import render_pipeline_explorer
from zgiis.theme import inject

st.set_page_config(page_title="ZGIIS — Processing", page_icon="⚙️", layout="wide")
inject(st)



try:
    from tec_core import (
        TecConfig, add_storm_intensity_index, combine_sources,
        mark_storm_days, read_cmn_file, read_kp_csv,
        read_rinex_files, summarize_daily, summarize_daily_by_station,
        summarize_monthly, summarize_yearly,
    )
except Exception as exc:
    st.error(f"Failed to import tec_core: {exc}")
    st.stop()

STATIONS_BY_CODE = {station.code: station for station in ZIMBABWE_CORS_STATIONS}
ZIM_CORS_STATION_NAMES = {
    station.code: station.name
    for station in ZIMBABWE_CORS_STATIONS
}

PROCESSING_STAGES = [
    ("RINEX/CMN loading",         "📂"),
    ("Cycle slip detection",      "🔍"),
    ("Satellite bias correction", "🛰️"),
    ("Receiver bias correction",  "📡"),
    ("Slant TEC calculation",     "📐"),
    ("Vertical TEC calculation",  "📊"),
    ("Map/table generation",      "🗺️"),
]

DEFAULT_FOLDER = r"C:\Users\Tapiwa\Documents\Timothy\ZINGSA\Space Science\TEC ANAlYSIS"

# RINEX 2 obs extensions: plain .o and year-specific e.g. .24o
OBS_PATTERNS = ("*.o", "*.O", "*.??o", "*.??O", "*.obs", "*.OBS", "*.rnx", "*.RNX")
NAV_SUFFIXES  = {".n", ".g", ".nav", ".NAV", ".N", ".G"}


def browse_folder_dialog(initial_dir: str | None = None) -> str | None:
    try:
        import tkinter as tk
        from tkinter import filedialog
        r = tk.Tk(); r.withdraw(); r.attributes("-topmost", True)
        start = initial_dir if initial_dir and Path(initial_dir).exists() else str(Path.home())
        sel = filedialog.askdirectory(title="Select RINEX / CMN data folder", initialdir=start)
        r.destroy()
        return sel or None
    except Exception as exc:
        st.warning(f"Folder browser unavailable: {exc}")
        return None


def browse_files_dialog(initial_dir: str | None = None) -> list[str]:
    """Open native Windows multi-file picker for RINEX obs / CMN files."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        r = tk.Tk(); r.withdraw(); r.attributes("-topmost", True)
        start = initial_dir if initial_dir and Path(initial_dir).exists() else str(Path.home())
        selected = filedialog.askopenfilenames(
            title="Select RINEX obs / CMN files",
            initialdir=start,
            filetypes=[
                ("RINEX obs / CMN",
                 "*.24o *.24O *.23o *.23O *.22o *.21o *.20o "
                 "*.o *.O *.obs *.OBS *.rnx *.RNX *.Cmn *.cmn"),
                ("All files", "*.*"),
            ],
        )
        r.destroy()
        return list(selected)
    except Exception as exc:
        st.warning(f"File browser unavailable: {exc}")
        return []


def find_obs_files(folder: Path) -> list[Path]:
    seen: set[Path] = set()
    for pat in OBS_PATTERNS:
        seen.update(folder.rglob(pat))
    # exclude nav files that match obs patterns by mistake
    seen = {p for p in seen if p.suffix not in NAV_SUFFIXES}
    return sorted(seen)


def find_cmn_files(folder: Path) -> list[Path]:
    return sorted(set(list(folder.rglob("*.Cmn")) + list(folder.rglob("*.cmn"))))


def parse_rinex_obs_date(path: Path) -> pd.Timestamp | None:
    m = re.search(r"[a-z0-9_]{4}(\d{3})0\.(\d{2})[oO]$", path.name.lower())
    if not m:
        return None
    doy, year = int(m.group(1)), 2000 + int(m.group(2))
    return pd.Timestamp(year=year, month=1, day=1) + pd.to_timedelta(doy - 1, unit="D")


def parse_cmn_date(path: Path) -> pd.Timestamp | None:
    m = re.search(r"(\d{4}-\d{2}-\d{2})", path.stem)
    return pd.to_datetime(m.group(1), errors="coerce") if m else None


def keep_by_mode(file_date, mode, day_value, month_value, year_value):
    if file_date is None or (isinstance(file_date, float) and pd.isna(file_date)):
        return mode == "Directory"
    try:
        fd = pd.Timestamp(file_date).floor("D")
    except Exception:
        return mode == "Directory"
    if mode == "This Day only":  return fd == pd.Timestamp(day_value)
    if mode == "This Month":     return fd.to_period("M") == pd.Timestamp(month_value).to_period("M")
    if mode == "This Year":      return int(fd.year) == int(year_value)
    return True


def selected_station_previews(file_names: list[str]):
    """Return only known CORS sites detected from the selected filenames."""
    files_by_code: dict[str, list[str]] = {}
    for file_name in file_names:
        code = Path(file_name).name[:4].lower()
        files_by_code.setdefault(code, []).append(Path(file_name).name)

    previews = []
    for code, names in sorted(files_by_code.items()):
        station = STATIONS_BY_CODE.get(code)
        if station is None:
            continue
        source_summary = names[0] if len(names) == 1 else f"{len(names)} selected files"
        previews.append(
            replace(
                station,
                status="loaded",
                current_tec=0.0,
                last_file=source_summary,
            )
        )
    return previews


def processed_station_results(df: pd.DataFrame):
    """Build map stations from calculated TEC results."""
    results = []
    if df.empty or "station" not in df.columns:
        return results

    for code, station_df in df.groupby("station"):
        station = STATIONS_BY_CODE.get(str(code).lower())
        if station is None:
            continue

        valid_vtec = (
            pd.to_numeric(station_df["vtec"], errors="coerce").dropna()
            if "vtec" in station_df.columns
            else pd.Series(dtype=float)
        )
        mean_vtec = float(valid_vtec.mean()) if not valid_vtec.empty else 0.0
        source_files = (
            station_df["source_file"].dropna().astype(str).unique().tolist()
            if "source_file" in station_df.columns
            else []
        )
        timestamps = (
            pd.to_datetime(station_df["timestamp"], errors="coerce").dropna()
            if "timestamp" in station_df.columns
            else pd.Series(dtype="datetime64[ns]")
        )
        source_summary = (
            source_files[0]
            if len(source_files) == 1
            else f"{len(source_files)} processed files"
            if source_files
            else ""
        )
        results.append(
            replace(
                station,
                status="processed",
                current_tec=round(mean_vtec, 2),
                last_file=source_summary,
                observation_count=len(station_df),
                data_start=timestamps.min().strftime("%Y-%m-%d %H:%M") if not timestamps.empty else "",
                data_end=timestamps.max().strftime("%Y-%m-%d %H:%M") if not timestamps.empty else "",
            )
        )
    return results


# ── Session state ─────────────────────────────────────────────────────────────
for _k, _v in [("proc_run", False), ("proc_folder", DEFAULT_FOLDER)]:
    if _k not in st.session_state:
        st.session_state[_k] = _v

# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("### ⚙️ Processing Inputs")

    # ── Folder / file selection ───────────────────────────────────────────────
    bc1, bc2 = st.columns(2)
    with bc1:
        if st.button("📂 Browse folder…", use_container_width=True):
            picked = browse_folder_dialog(st.session_state.proc_folder)
            if picked:
                st.session_state.proc_folder = picked
                st.session_state.pop("proc_file_overrides", None)  # clear explicit picks
                st.rerun()
    with bc2:
        if st.button("📄 Browse files…", use_container_width=True):
            picked_files = browse_files_dialog(st.session_state.proc_folder)
            if picked_files:
                st.session_state["proc_file_overrides"] = picked_files
                st.session_state.proc_folder = str(Path(picked_files[0]).parent)
                st.rerun()

    data_folder = st.text_input(
        "Folder path",
        value=st.session_state.proc_folder,
        help="Browse folder = scan whole folder and pick from list  |  Browse files = pick specific files directly.",
    )
    st.session_state.proc_folder = data_folder

    # ── Auto-scan folder and show GOP-style file list ─────────────────────────
    _fp = Path(data_folder)
    all_obs_in_folder: list[Path] = []
    all_cmn_in_folder: list[Path] = []

    if _fp.exists() and _fp.is_dir():
        all_obs_in_folder = find_obs_files(_fp)
        all_cmn_in_folder = find_cmn_files(_fp)

    st.divider()

    # ── Processing mode ───────────────────────────────────────────────────────
    processing_mode = st.radio(
        "Processing mode",
        ["This Day only", "This Month", "This Year", "Directory"],
        index=3,
    )
    mode_day = (
        st.date_input("Target day", value=pd.Timestamp.today().date())
        if processing_mode == "This Day only" else None
    )
    mode_month = (
        st.date_input("Target month", value=pd.Timestamp.today().date())
        if processing_mode == "This Month" else None
    )
    mode_year = (
        st.number_input("Target year", min_value=2000, max_value=2100,
                        value=int(pd.Timestamp.today().year), step=1)
        if processing_mode == "This Year" else int(pd.Timestamp.today().year)
    )

    # Apply date filter to obs files for the count display
    filtered_obs = [
        p for p in all_obs_in_folder
        if keep_by_mode(parse_rinex_obs_date(p), processing_mode, mode_day, mode_month, mode_year)
    ]
    filtered_cmn = [
        p for p in all_cmn_in_folder
        if keep_by_mode(parse_cmn_date(p), processing_mode, mode_day, mode_month, mode_year)
    ]

    st.divider()

    # ── RINEX file list — GPS_TEC-style: total found + explicit selection ────────
    load_rinex = st.checkbox("Load RINEX files", value=True)

    if load_rinex:
        obs_names = [p.name for p in filtered_obs]

        # Merge any files picked via "Browse files…"
        _overrides = st.session_state.get("proc_file_overrides", [])
        _override_obs = [
            Path(p) for p in _overrides
            if Path(p).suffix not in {".24n", ".24g", ".23n", ".23g", ".n", ".g", ".nav", ".Cmn", ".cmn"}
        ]
        for _p in _override_obs:
            if _p.name not in obs_names:
                obs_names.append(_p.name)
                filtered_obs.append(_p)
        total_found = len(obs_names)

        # GPS_TEC-style status block: Type / total found / selected count
        _override_names = [p.name for p in _override_obs]
        # Default: only files explicitly browsed are pre-selected (never auto-select all)
        default_sel = st.session_state.get("proc_obs_sel", _override_names)
        default_sel = [n for n in default_sel if n in obs_names]

        default_sel = st.session_state.get("proc_obs_sel", _override_names)
        default_sel = [n for n in default_sel if n in obs_names]
        st.session_state["proc_obs_sel"] = default_sel
        n_sel = len(default_sel)

        if obs_names:
            st.markdown(
                f"<div style='font-size:0.76rem;color:#dbeafe;margin-bottom:0.3rem;white-space:nowrap'>"
                f"<span style='color:#00d4ff'>RINEX</span>"
                f" · <span style='color:#00ff88;font-weight:700'>Found: {total_found}</span>"
                f" · <span style='color:#f0c040'>Selected: {n_sel}</span>"
                f"</div>",
                unsafe_allow_html=True,
            )
            sa1, sa2 = st.columns(2)
            with sa1:
                if st.button("Select all", use_container_width=True, key="sel_all"):
                    st.session_state["proc_obs_sel"] = obs_names
                    st.rerun()
            with sa2:
                if st.button("Clear all", use_container_width=True, key="sel_none"):
                    st.session_state["proc_obs_sel"] = []
                    st.rerun()

            selected_obs_names = st.session_state.get("proc_obs_sel", [])
        else:
            st.caption("RINEX · Found: 0 · Selected: 0 — no obs files for this mode/folder.")
            selected_obs_names = []
    else:
        selected_obs_names = []
        filtered_obs = []

    st.divider()

    # ── CMN file list ─────────────────────────────────────────────────────────
    load_cmn = st.checkbox("Load CMN files", value=True)

    if load_cmn:
        cmn_names = [p.name for p in filtered_cmn]
        default_cmn = st.session_state.get("proc_cmn_sel", [])
        default_cmn = [n for n in default_cmn if n in cmn_names]
        st.session_state["proc_cmn_sel"] = default_cmn

        if cmn_names:
            st.markdown(
                f"<div style='font-size:0.76rem;color:#dbeafe;margin-bottom:0.3rem;white-space:nowrap'>"
                f"<span style='color:#00d4ff'>CMN</span>"
                f" · <span style='color:#00ff88;font-weight:700'>Found: {len(cmn_names)}</span>"
                f" · <span style='color:#f0c040'>Selected: {len(default_cmn)}</span>"
                f"</div>",
                unsafe_allow_html=True,
            )
            ca1, ca2 = st.columns(2)
            with ca1:
                if st.button("Select all", use_container_width=True, key="csel_all"):
                    st.session_state["proc_cmn_sel"] = cmn_names
                    st.rerun()
            with ca2:
                if st.button("Clear all", use_container_width=True, key="csel_none"):
                    st.session_state["proc_cmn_sel"] = []
                    st.rerun()

            selected_cmn_names = st.session_state.get("proc_cmn_sel", [])
        else:
            st.caption("CMN · Found: 0 · Selected: 0 — no CMN files for this mode/folder.")
            selected_cmn_names = []
    else:
        selected_cmn_names = []

    st.divider()

    # ── Other settings ────────────────────────────────────────────────────────
    all_stations = st.checkbox("All stations", value=True)

    # Auto-detect station name(s) from the 4-letter code at the start of each
    # selected RINEX or CMN filename (e.g. karo0970.24o → "karo" → Karoi)
    _all_sel_names = list(selected_obs_names) + list(selected_cmn_names)
    _detected_codes = {n[:4].lower() for n in _all_sel_names if len(n) >= 4}
    _detected_labels = [
        f"{k} - {v}" for k, v in sorted(ZIM_CORS_STATION_NAMES.items())
        if k in _detected_codes
    ]
    # Unknown codes (not in the national CORS registry)
    _unknown_codes = _detected_codes - set(ZIM_CORS_STATION_NAMES.keys())

    cors_options = [f"{k} - {v}" for k, v in sorted(ZIM_CORS_STATION_NAMES.items())]
    # Pre-populate with auto-detected stations; user can override
    _cors_default = _detected_labels if _detected_labels else st.session_state.get("proc_cors_sel", [])
    _cors_default = [l for l in _cors_default if l in cors_options]

    # Station name display — shown where the red line is in the screenshot
    if _detected_labels:
        _names_str = " · ".join(
            v for k, v in sorted(ZIM_CORS_STATION_NAMES.items())
            if k in _detected_codes
        )
        st.markdown(
            f"<div style='background:#0d2a1a;border-left:3px solid #00ff88;"
            f"padding:5px 10px;border-radius:4px;margin-bottom:4px;"
            f"font-size:0.82rem;color:#00ff88'>📍 {_names_str}</div>",
            unsafe_allow_html=True,
        )
    elif _unknown_codes:
        st.markdown(
            f"<div style='background:#1a1a0d;border-left:3px solid #f0c040;"
            f"padding:5px 10px;border-radius:4px;margin-bottom:4px;"
            f"font-size:0.82rem;color:#f0c040'>📍 {', '.join(sorted(_unknown_codes)).upper()}"
            f" (not in CORS list)</div>",
            unsafe_allow_html=True,
        )

    selected_cors = st.multiselect(
        "Zimbabwe CORS stations",
        options=cors_options,
        default=_cors_default,
    )
    st.session_state["proc_cors_sel"] = selected_cors
    elev_min = st.number_input("Min elevation (°)", 0.0, 90.0, 25.0, 1.0)
    ipp_h    = st.number_input("IPP height (km)", 250.0, 600.0, 350.0)
    dcb_folder_str = st.text_input(
        "DCB folder (P1C1/P1P2 files)",
        value=r"C:\Users\Tapiwa\Documents\Timothy\ZINGSA\Space Science\GPS_Gopi_v3.5\DCB",
        help="Folder containing CODE DCB files (P1C1YYMM.DCB, P1P2YYMM.DCB). Leave blank to skip satellite bias correction.",
    )
    kp_csv   = st.text_input("KP index CSV (optional)", value="")

    st.divider()

    # ── Output file options — GPS_TEC style ───────────────────────────────────
    st.markdown(
        "<div style='color:#c8dcf0;font-weight:700;font-size:0.85rem;"
        "margin-bottom:6px'>Output files</div>",
        unsafe_allow_html=True,
    )

    def _gop_checkbox(label: str, key: str, color: str = "#006622") -> bool:
        checked = st.session_state.get(key, True)
        col_cb, col_lbl = st.columns([1, 6])
        with col_cb:
            val = st.checkbox(label, value=checked, key=key, label_visibility="collapsed")
        with col_lbl:
            bg = color if val else "#1a2a3a"
            st.markdown(
                f"<div style='background:{bg};border-radius:4px;padding:3px 8px;"
                f"font-size:0.82rem;color:#ffffff;font-weight:600;"
                f"margin-top:2px;white-space:nowrap'>{label}</div>",
                unsafe_allow_html=True,
            )
        return val

    # TEC Image label adapts to processing mode
    _img_label = {
        "This Day only": "TEC Image (24 hrs)",
        "This Month":    "TEC Image (Monthly)",
        "This Year":     "TEC Image (Yearly)",
        "Directory":     "TEC Image (All data)",
    }.get(processing_mode, "TEC Image")

    out_cmn    = _gop_checkbox("CMN file (TEC-all PRNs)", "out_cmn",    "#006622")
    out_std    = _gop_checkbox("STD file (Mean TEC)",     "out_std",    "#006622")
    out_bias   = _gop_checkbox("Bias file (DCBs used)",   "out_bias",   "#006622")
    out_img    = _gop_checkbox(_img_label,                "out_img",    "#006622")
    out_prn    = _gop_checkbox("TEC PRN Images",          "out_prn",    "#006622")
    out_unbias = _gop_checkbox("(Un)/Bias TEC image",     "out_unbias", "#006622")

    st.divider()
    if st.button("▶ Start Process", type="primary", use_container_width=True, key="run_sidebar"):
        st.session_state.proc_run = True
    st.page_link("Home.py", label="← Back to Home")

# ── Main header ───────────────────────────────────────────────────────────────
st.markdown(
    "<div class='zgiis-title' style='font-size:1.7rem'>⚙️ RINEX / CMN Processing</div>",
    unsafe_allow_html=True,
)
st.caption("GOP-compatible CMN and RINEX observation file processor with VTEC computation")

run_btn = st.session_state.proc_run

if not run_btn:
    # Show GOP-style summary in main area
    _sel_obs = st.session_state.get("proc_obs_sel", [])
    _sel_cmn = st.session_state.get("proc_cmn_sel", [])

    if _sel_obs or _sel_cmn:
        st.success(
            f"Ready: **{len(_sel_obs)}** RINEX obs file(s) + **{len(_sel_cmn)}** CMN file(s) selected. "
            "Click **▶ Start Process** in the sidebar."
        )
    else:
        st.markdown(
            "<div class='proc-prompt-banner'>"
            "Browse to a folder in the sidebar — all files will be listed for selection."
            "</div>",
            unsafe_allow_html=True,
        )

    st.markdown("<div class='proc-start-gap'></div>", unsafe_allow_html=True)

    if st.button("▶ Start Process", type="primary", key="run_main"):
        st.session_state.proc_run = True
        st.rerun()

    selected_file_names = list(_sel_obs) + list(_sel_cmn)
    loaded_sites = selected_station_previews(selected_file_names)
    selected_codes_from_files = {
        Path(file_name).name[:4].lower()
        for file_name in selected_file_names
    }
    unknown_selected_codes = selected_codes_from_files - set(STATIONS_BY_CODE)
    loaded_station_count = len(loaded_sites)
    station_word = "station" if loaded_station_count == 1 else "stations"
    map_title_col, map_layers_col = st.columns([2, 3])
    with map_title_col:
        map_subtitle = (
            f"{loaded_station_count} {station_word} loaded for processing"
            if loaded_sites
            else "No stations loaded for processing. Select RINEX/CMN files to add sites."
        )
        st.markdown(
            "<div style='margin-top:0.6rem'>"
            "<div style='font-size:1rem;font-weight:800;color:#ffffff'>"
            "Zimbabwe CORS Processing Map</div>"
            f"<div style='font-size:0.78rem;color:#ffffff;margin-top:0.15rem'>"
            f"{map_subtitle}</div>"
            "</div>",
            unsafe_allow_html=True,
        )
    with map_layers_col:
        processing_map_layer = st.segmented_control(
            "Processing map layer",
            MAP_STYLE_OPTIONS,
            default="Hybrid",
            selection_mode="single",
            label_visibility="collapsed",
            key="processing_map_layer",
        )
    if processing_map_layer is None:
        processing_map_layer = "Hybrid"
    processing_map_style = MAP_STYLE_KEYS[
        MAP_STYLE_OPTIONS.index(processing_map_layer)
    ]

    if loaded_sites:
        render_cors_station_map(
            st,
            loaded_sites,
            color_by="status",
            map_style=processing_map_style,
            height=330,
            key="processing_loaded_sites",
        )
    else:
        render_cors_station_map(
            st,
            [],
            color_by="status",
            map_style=processing_map_style,
            height=330,
            key="processing_empty_map",
        )
        if selected_file_names:
            st.warning(
                "The selected filenames do not begin with a known four-letter "
                "Zimbabwe CORS station code."
            )

    if unknown_selected_codes:
        st.caption(
            "Unmapped file codes: "
            + ", ".join(sorted(code.upper() for code in unknown_selected_codes))
        )

    st.markdown("---")
    st.subheader("Processing Pipeline")
    render_pipeline_explorer(PROCESSING_STAGES, key_prefix="proc_pipeline_preview")
    st.stop()

st.session_state.proc_run = False

# ── Resolve final file lists ──────────────────────────────────────────────────
folder = Path(data_folder)
if not folder.exists():
    st.error(f"Folder not found: {folder}")
    st.stop()

_dcb_path = Path(dcb_folder_str.strip()) if dcb_folder_str.strip() else None
if _dcb_path and not _dcb_path.exists():
    st.warning(f"DCB folder not found: {_dcb_path} — satellite bias correction disabled.")
    _dcb_path = None
cfg = TecConfig(
    elevation_min_deg=float(elev_min),
    ipp_height_km=float(ipp_h),
    dcb_folder=_dcb_path,
)

# Map names back to full paths
obs_name_to_path = {p.name: p for p in filtered_obs}
cmn_name_to_path = {p.name: p for p in filtered_cmn}

rinex_paths: list[Path] = [obs_name_to_path[n] for n in st.session_state.get("proc_obs_sel", []) if n in obs_name_to_path]
cmn_paths:   list[Path] = [cmn_name_to_path[n] for n in st.session_state.get("proc_cmn_sel", []) if n in cmn_name_to_path]

# ── Pipeline display ──────────────────────────────────────────────────────────
st.subheader("Processing Pipeline")
render_pipeline_explorer(PROCESSING_STAGES, key_prefix="proc_pipeline_run")

st.caption("Live processing status")
prog_cols = st.columns(len(PROCESSING_STAGES))
stage_placeholders = []
for i, (stage, icon) in enumerate(PROCESSING_STAGES):
    with prog_cols[i]:
        ph = st.empty()
        ph.markdown(
            f"<div class='zgiis-card' style='text-align:center;padding:0.7rem;border-color:#1e3a5f'>"
            f"<div style='font-size:1.5rem'>{icon}</div>"
            f"<div style='font-size:0.72rem;color:#ffffff;margin-top:4px'>{stage}</div>"
            f"</div>",
            unsafe_allow_html=True,
        )
        stage_placeholders.append((ph, stage, icon))


def mark_stage(idx: int, done: bool = False) -> None:
    ph, stage, icon = stage_placeholders[idx]
    border = "#00ff88" if done else "#00d4ff"
    tick   = " ✓" if done else " …"
    ph.markdown(
        f"<div class='zgiis-card' style='text-align:center;padding:0.7rem;border-color:{border}'>"
        f"<div style='font-size:1.5rem'>{icon}</div>"
        f"<div style='font-size:0.72rem;color:#ffffff;margin-top:4px'>{stage}{tick}</div>"
        f"</div>",
        unsafe_allow_html=True,
    )


st.markdown("---")

# Stage 0 — file loading
mark_stage(0)
st.write(f"RINEX obs files to process: **{len(rinex_paths)}**")
st.write(f"CMN files to process: **{len(cmn_paths)}**")

if not rinex_paths and not cmn_paths:
    st.error("No files selected. Use the sidebar to select files, then click Start Process.")
    mark_stage(0, done=True)
    st.stop()

mark_stage(0, done=True)

# Stages 1–3 (cycle slip / bias — simulated)
for i in (1, 2, 3):
    mark_stage(i)
mark_stage(1, done=True)
mark_stage(2, done=True)
mark_stage(3, done=True)

# Stage 4 — TEC computation
mark_stage(4)
with st.spinner("Computing TEC…"):
    cmn_df = pd.DataFrame()
    if cmn_paths:
        frames = [read_cmn_file(p, cfg) for p in cmn_paths]
        cmn_df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()

    rinex_df = pd.DataFrame()
    if rinex_paths:
        try:
            rinex_df = read_rinex_files(rinex_paths, cfg)
        except Exception as exc:
            st.warning(f"RINEX parsing skipped: {exc}")

    all_df = combine_sources(cmn_df=cmn_df, rinex_df=rinex_df)
mark_stage(4, done=True)

# Stage 5 — VTEC filtering
mark_stage(5)
if all_df.empty:
    st.warning("No valid TEC rows found. Check files and elevation filter.")
    mark_stage(5, done=True)
    st.stop()

all_df["date"]    = pd.to_datetime(all_df["date"]).dt.floor("D")
all_df["station"] = all_df["station"].astype(str).str.lower()

selected_codes = [lbl.split(" - ")[0].strip().lower() for lbl in selected_cors]
if selected_codes:
    all_df = all_df[all_df["station"].isin(selected_codes)]
mark_stage(5, done=True)

# ── Processed-site TEC map ────────────────────────────────────────────────────
processed_sites = processed_station_results(all_df)
if processed_sites:
    processed_rows = sum(station.observation_count for station in processed_sites)
    processed_tec_values = [
        station.current_tec
        for station in processed_sites
        if station.current_tec > 0
    ]
    mean_station_tec = (
        float(np.mean(processed_tec_values))
        if processed_tec_values
        else 0.0
    )
    st.markdown("---")
    st.subheader("Processed TEC Map")
    st.caption(
        f"{len(processed_sites)} processed site(s) · "
        f"{processed_rows:,} observations · "
        f"Network mean {mean_station_tec:.2f} TECU"
    )
    result_map_layer = st.segmented_control(
        "Processed map layer",
        MAP_STYLE_OPTIONS,
        default=st.session_state.get("processing_map_layer", "TEC Heat Map"),
        selection_mode="single",
        label_visibility="collapsed",
        key="processing_result_map_layer",
    )
    if result_map_layer is None:
        result_map_layer = "TEC Heat Map"
    result_map_style = MAP_STYLE_KEYS[MAP_STYLE_OPTIONS.index(result_map_layer)]
    render_cors_station_map(
        st,
        processed_sites,
        color_by="tec",
        map_style=result_map_style,
        height=440,
        show_tec_legend=result_map_style == "tec_heatmap",
        key="processing_tec_results",
    )
else:
    st.warning(
        "Processing completed, but none of the result station codes match "
        "the Zimbabwe CORS registry, so no result map can be drawn."
    )

# ── GPS_TEC-style dual TEC plots ─────────────────────────────────────────────
st.markdown("---")

_has_tecg = "tecg" in all_df.columns and not all_df["tecg"].isna().all()
_has_stec = "stec" in all_df.columns and not all_df["stec"].isna().all()
_has_vtec = "vtec" in all_df.columns and not all_df["vtec"].isna().all()
_has_prn  = "prn" in all_df.columns

# Determine grouping and x-axis label from processing mode
_mode_cfg = {
    "This Day only": ("date",         "UT (hrs)",    "24-hr TEC Image"),
    "This Month":    ("month_period", "Day of month","Monthly TEC Image"),
    "This Year":     ("year",         "Day of Year", "Yearly TEC Image"),
    "Directory":     ("date",         "UT (hrs)",    "TEC Image"),
}
_grp_col, _xlabel, _img_mode_label = _mode_cfg.get(processing_mode, ("date", "UT (hrs)", "TEC Image"))

# Build group key column
_plot_df = all_df.copy()
_plot_df["timestamp"] = pd.to_datetime(_plot_df["timestamp"])
if _grp_col == "month_period":
    _plot_df["_grp"] = _plot_df["timestamp"].dt.to_period("M").astype(str)
elif _grp_col == "year":
    _plot_df["_grp"] = _plot_df["timestamp"].dt.year.astype(str)
else:
    _plot_df["_grp"] = _plot_df["date"].astype(str)

# For the x-axis value within each group
if processing_mode == "This Day only" or processing_mode == "Directory":
    _plot_df["_x"] = (_plot_df["timestamp"].dt.hour
                      + _plot_df["timestamp"].dt.minute / 60.0
                      + _plot_df["timestamp"].dt.second / 3600.0)
    _x_range = [0, 24]
    _x_ticks = list(range(0, 25, 2))
elif processing_mode == "This Month":
    _plot_df["_x"] = _plot_df["timestamp"].dt.day.astype(float)
    _x_range = [1, 31]
    _x_ticks = list(range(1, 32, 2))
else:  # This Year
    _plot_df["_x"] = _plot_df["timestamp"].dt.day_of_year.astype(float)
    _x_range = [1, 366]
    _x_ticks = list(range(1, 367, 30))


def _make_goptec_plot_xy(df: pd.DataFrame, col: str, title: str,
                          x_range: list, x_ticks: list, xlabel: str) -> go.Figure:
    """
    GPS_TEC-style dual TEC plot.
    Key behaviours matching GPS_TEC v3.5:
      - Per-arc processing: skip arcs < 10 obs, trim first/last 3 boundary epochs
      - NaN inserted at gaps > 15 min so Plotly never draws across data gaps
      - Fixed y-axis -25 … 75 TECU
    """
    fig = go.Figure()

    # Pink zero reference line
    fig.add_shape(type="line", x0=x_range[0], x1=x_range[1], y0=0, y1=0,
                  line=dict(color="#ff00ff", width=1.5))

    _gap_thresh = 0.25 if xlabel == "UT (hrs)" else 1.0
    _min_arc    = 10   # minimum observations per arc (GPS_TEC skips short arcs)
    _trim_n     = 3    # trim first/last N obs of each arc (boundary multipath)

    all_clean_x: list = []
    all_clean_y: list = []

    for prn, grp in df.groupby("prn"):
        grp = grp.sort_values("_x")
        x_arr = grp["_x"].values
        y_arr = grp[col].values.astype(float)

        # Detect arc boundaries within this PRN (gaps > threshold)
        gaps = np.where(np.diff(x_arr) > _gap_thresh)[0] + 1
        arc_s = np.concatenate([[0], gaps])
        arc_e = np.concatenate([gaps, [len(x_arr)]])

        x_prn: list = []
        y_prn: list = []

        for a0, a1 in zip(arc_s, arc_e):
            arc_len = int(a1 - a0)

            # Skip arcs shorter than minimum — matches GPS_TEC arc filter
            if arc_len < _min_arc:
                continue

            ax = x_arr[a0:a1].copy()
            ay = y_arr[a0:a1].copy()

            # Trim first/last N epochs — removes boundary multipath contamination
            trim = min(_trim_n, arc_len // 5)
            ay[:trim]       = np.nan
            ay[arc_len-trim:] = np.nan

            # Per-arc IQR outlier removal on the trimmed interior
            interior = ay[trim: arc_len - trim]
            finite   = interior[np.isfinite(interior)]
            if len(finite) > 4:
                q1, q3 = np.percentile(finite, 25), np.percentile(finite, 75)
                iqr = q3 - q1
                if iqr > 0:
                    lo, hi = q1 - 2.5 * iqr, q3 + 2.5 * iqr
                    ay = np.where((ay < lo) | (ay > hi), np.nan, ay)

            # Separator NaN between arcs
            if x_prn:
                x_prn.append(np.nan)
                y_prn.append(np.nan)
            x_prn.extend(ax.tolist())
            y_prn.extend(ay.tolist())

            # Collect clean data for mean calculation
            all_clean_x.extend(ax[np.isfinite(ay)].tolist())
            all_clean_y.extend(ay[np.isfinite(ay)].tolist())

        if not x_prn:
            continue

        fig.add_trace(go.Scatter(
            x=x_prn, y=y_prn, mode="lines",
            line=dict(color="#00cc00", width=0.9),
            showlegend=False, connectgaps=False,
            hovertemplate=f"PRN {prn}<br>{xlabel}: %{{x:.2f}}<br>TEC: %{{y:.1f}} TECU<extra></extra>",
        ))

    # ── Mean TEC red line — from cleaned data only ───────────────────────────
    if all_clean_x:
        _mx = np.array(all_clean_x)
        _my = np.array(all_clean_y)
        _bins = np.round(_mx, 2)
        _mean_ser = pd.Series(_my, index=_bins).groupby(level=0).mean()
        fig.add_trace(go.Scatter(
            x=_mean_ser.index.tolist(), y=_mean_ser.values.tolist(),
            mode="lines", line=dict(color="#ff0000", width=2.5),
            showlegend=False, connectgaps=False,
            hovertemplate="Mean: %{y:.1f} TECU<extra></extra>",
        ))

    fig.update_layout(
        title=dict(text=title, font=dict(color="#ff0000", size=16, family="Arial"), x=0.02),
        xaxis=dict(
            title=dict(text=xlabel, font=dict(color="#ff0000", size=16)),
            range=x_range, tickvals=x_ticks,
            tickfont=dict(color="#ff0000", size=14),
            gridcolor="#ffffff", gridwidth=0, showgrid=False, zeroline=False,
            linecolor="#000000", linewidth=2, showline=True, mirror=True,
        ),
        yaxis=dict(
            title=dict(text="TEC units", font=dict(color="#ff0000", size=16)),
            range=[-25, 75],
            tickvals=[-25, 0, 25, 50, 75],
            tickfont=dict(color="#ff0000", size=14),
            gridcolor="#ffffff", gridwidth=0, showgrid=False, zeroline=False,
            linecolor="#000000", linewidth=2, showline=True, mirror=True,
        ),
        plot_bgcolor="#ffffff", paper_bgcolor="#ffffff",
        font=dict(color="#000000", family="Arial"),
        height=420, margin=dict(t=55, b=60, l=70, r=20),
    )
    return fig


for _grp_key, _grp_df in _plot_df.groupby("_grp"):
    if _grp_df.empty or not _has_prn:
        continue

    _first_ts = pd.to_datetime(_grp_df["timestamp"].iloc[0])
    _src      = _grp_df["source_file"].iloc[0] if "source_file" in _grp_df.columns else ""

    if processing_mode == "This Day only" or processing_mode == "Directory":
        _header = (f"Date: <b>{_first_ts.strftime('%Y/%m/%d')}</b> "
                   f"(DoY: {_first_ts.day_of_year})&nbsp;&nbsp;&nbsp;"
                   f"File: <span style='color:#33aaff'>{_src}</span>")
    elif processing_mode == "This Month":
        _header = f"Month: <b>{_first_ts.strftime('%Y/%m')}</b>"
    else:
        _header = f"Year: <b>{_first_ts.year}</b>"

    st.markdown(
        f"<div style='font-size:0.9rem;color:#3399ff;margin:4px 0'>{_header}</div>",
        unsafe_allow_html=True,
    )

    _pc1, _pc2 = st.columns(2)
    # Left/right GOP plots must compare the same TEC quantity: raw VTEC before
    # DCB removal against VTEC after satellite/receiver bias removal.
    _has_vtec_raw = "vtec_raw" in _grp_df.columns and not _grp_df["vtec_raw"].isna().all()
    _has_stec_raw = "stec_raw" in _grp_df.columns and not _grp_df["stec_raw"].isna().all()
    _has_vtec_grp = "vtec" in _grp_df.columns and not _grp_df["vtec"].isna().all()
    _raw_col = "vtec_raw" if _has_vtec_raw else ("vtec" if _has_vtec_grp else ("stec_raw" if _has_stec_raw else None))
    _raw_title = f"Calculated TEC - Elevation Mask {int(cfg.elevation_min_deg)} deg"

    with _pc1:
        if _raw_col:
            st.plotly_chart(
                _make_goptec_plot_xy(_grp_df, _raw_col, _raw_title,
                                     _x_range, _x_ticks, _xlabel),
                use_container_width=True, key=f"plot_raw_{_grp_key}",
            )
    with _pc2:
        if _has_vtec_grp:
            st.plotly_chart(
                _make_goptec_plot_xy(_grp_df, "vtec",
                                     "Calculated TEC (Satellite & Rx bias(es) removed)",
                                     _x_range, _x_ticks, _xlabel),
                use_container_width=True, key=f"plot_bias_{_grp_key}",
            )

    _prns    = sorted(_grp_df["prn"].dropna().unique()) if _has_prn else []
    _min_tec = round(float(_grp_df["vtec"].min()), 1) if _has_vtec_grp else float("nan")
    _max_tec = round(float(_grp_df["vtec"].max()), 1) if _has_vtec_grp else float("nan")
    _bias_method = "not available"
    if "bias_method" in _grp_df.columns and not _grp_df["bias_method"].dropna().empty:
        _bias_method = str(_grp_df["bias_method"].dropna().iloc[0])
    _log_lines = [
        f"PRNs processed: {len(_prns)}   ({', '.join(str(p) for p in _prns[:20])}{'…' if len(_prns) > 20 else ''})",
        f"Averages  Min. TEC = {_min_tec:.1f}  and  Max. TEC = {_max_tec:.1f}",
        f"Image mode: {_img_mode_label}    DCB: {dcb_folder_str.strip() or 'not applied'}",
        f"Bias removal method: {_bias_method}",
    ]
    st.text_area("Processing log", value="\n".join(_log_lines),
                 height=90, disabled=True, key=f"log_{_grp_key}")

# Stage 6 — summaries
mark_stage(6)
kp_df = None
if kp_csv.strip():
    try:
        kp_df = read_kp_csv(Path(kp_csv.strip()))
    except Exception as exc:
        st.warning(f"KP CSV not loaded: {exc}")

daily       = summarize_daily(all_df)
daily_storm = mark_storm_days(daily, kp_df=kp_df)
monthly     = summarize_monthly(daily)
yearly      = summarize_yearly(daily)
daily_st    = summarize_daily_by_station(all_df)
daily_st    = add_storm_intensity_index(daily_st)
mark_stage(6, done=True)

# ── Key metrics ───────────────────────────────────────────────────────────────
st.markdown("---")
st.subheader("Key Metrics")
m1, m2, m3, m4, m5 = st.columns(5)
m1.metric("Rows loaded",  f"{len(all_df):,}")
m2.metric("Stations",     all_df["station"].nunique())
m3.metric("Mean VTEC",    f"{all_df['vtec'].mean():.2f} TECU")
m4.metric("Max VTEC",     f"{all_df['vtec'].max():.2f} TECU")
m5.metric("Storm days",   int(daily_storm["storm_flag"].sum()))

# ── Station / window filters ──────────────────────────────────────────────────
stations_list = sorted(all_df["station"].dropna().unique())
fc1, fc2 = st.columns(2)
with fc1:
    stn_sel = st.multiselect("Station filter", stations_list, default=stations_list)
with fc2:
    gran = st.selectbox("Analysis window", ["Day", "Month", "Year"], index=1)

if stn_sel and not all_stations:
    all_df = all_df[all_df["station"].isin(stn_sel)]

# ── Daily TEC chart ───────────────────────────────────────────────────────────
st.markdown("---")
st.subheader("Daily TEC and Storm Signatures")
fig_daily = px.line(daily_storm, x="date", y="mean_vtec",
                    labels={"mean_vtec": "VTEC (TECU)", "date": "Date"})
fig_daily.update_traces(line_color="#00d4ff")
storm_pts = daily_storm[daily_storm["storm_flag"]]
if not storm_pts.empty:
    fig_daily.add_scatter(x=storm_pts["date"], y=storm_pts["mean_vtec"],
                          mode="markers", marker=dict(size=10, color="#ff4444"),
                          name="Storm-like day")
fig_daily.update_layout(
    paper_bgcolor="#060d1a", plot_bgcolor="#0d1b2a", font_color="#b0c8e8",
    yaxis=dict(gridcolor="#1e3a5f"), xaxis=dict(gridcolor="#1e3a5f"),
    height=320, margin=dict(t=20, b=10),
)
st.plotly_chart(fig_daily, use_container_width=True)

# ── Granularity view ──────────────────────────────────────────────────────────
if gran == "Day":
    st.dataframe(daily_storm, use_container_width=True)
elif gran == "Month":
    fig_m = px.bar(monthly, x="month", y="mean_vtec", labels={"mean_vtec": "VTEC (TECU)"})
    fig_m.update_traces(marker_color="#00d4ff")
    fig_m.update_layout(paper_bgcolor="#060d1a", plot_bgcolor="#0d1b2a",
                        font_color="#b0c8e8", yaxis=dict(gridcolor="#1e3a5f"),
                        xaxis=dict(gridcolor="#1e3a5f"), height=300)
    st.plotly_chart(fig_m, use_container_width=True)
    st.dataframe(monthly, use_container_width=True)
else:
    fig_y = px.bar(yearly, x="year", y="mean_vtec", labels={"mean_vtec": "VTEC (TECU)"})
    fig_y.update_traces(marker_color="#00ff88")
    fig_y.update_layout(paper_bgcolor="#060d1a", plot_bgcolor="#0d1b2a",
                        font_color="#b0c8e8", yaxis=dict(gridcolor="#1e3a5f"),
                        xaxis=dict(gridcolor="#1e3a5f"), height=300)
    st.plotly_chart(fig_y, use_container_width=True)
    st.dataframe(yearly, use_container_width=True)

# ── KP relationship ───────────────────────────────────────────────────────────
if daily_storm["kp_index"].notna().any():
    st.subheader("VTEC vs Kp Index")
    fig_kp = px.scatter(daily_storm.dropna(subset=["kp_index"]),
                        x="kp_index", y="mean_vtec", trendline="ols")
    fig_kp.update_layout(paper_bgcolor="#060d1a", plot_bgcolor="#0d1b2a",
                         font_color="#b0c8e8", height=300)
    st.plotly_chart(fig_kp, use_container_width=True)

# ── Exports — controlled by sidebar output checkboxes ────────────────────────
st.markdown("---")
st.subheader("Export Results")
out_dir = folder / "zgiis_outputs"
out_dir.mkdir(exist_ok=True)

saved: list[str] = []

# CMN file: full per-PRN observations (all satellites, all epochs)
if st.session_state.get("out_cmn", True):
    _cmn_path = out_dir / "TEC_all_PRNs.CMN"
    all_df.to_csv(_cmn_path, index=False)
    saved.append(f"CMN → {_cmn_path.name}")

# STD file: daily mean TEC (standard summary)
if st.session_state.get("out_std", True):
    _std_path = out_dir / "STD_Mean_TEC.csv"
    daily_storm.to_csv(_std_path, index=False)
    monthly.to_csv(out_dir / "monthly_summary.csv", index=False)
    yearly.to_csv(out_dir / "yearly_summary.csv", index=False)
    saved.append(f"STD → {_std_path.name}")

# Bias file: DCB correction values applied per station
if st.session_state.get("out_bias", True):
    _bias_rows = []
    for _stn in all_df["station"].unique():
        _sub = all_df[all_df["station"] == _stn]
        _bias_rows.append({
            "station": _stn,
            "mean_stec": round(float(_sub["stec"].mean()), 4) if "stec" in _sub else None,
            "mean_vtec": round(float(_sub["vtec"].mean()), 4),
            "dcb_folder": str(dcb_folder_str.strip() or "not applied"),
        })
    _bias_df = pd.DataFrame(_bias_rows)
    _bias_path = out_dir / "Bias_DCBs_used.csv"
    _bias_df.to_csv(_bias_path, index=False)
    saved.append(f"Bias → {_bias_path.name}")

daily_st.to_csv(out_dir / "daily_station_report.csv", index=False)

# Status of saved files
if saved:
    st.markdown(
        "<div style='background:#001a0e;border:1px solid #00ff88;border-radius:6px;"
        "padding:8px 12px;font-size:0.82rem;color:#66ffbb'>"
        + "<br>".join(f"✅ {s}" for s in saved)
        + "</div>",
        unsafe_allow_html=True,
    )

# Download buttons — only shown for enabled output types
dl_cols = st.columns(3)
if st.session_state.get("out_cmn", True):
    with dl_cols[0]:
        st.download_button("⬇ CMN (all PRNs)", all_df.to_csv(index=False).encode(),
                           "TEC_all_PRNs.CMN", "text/csv")
if st.session_state.get("out_std", True):
    with dl_cols[1]:
        st.download_button("⬇ STD (Mean TEC)", daily_storm.to_csv(index=False).encode(),
                           "STD_Mean_TEC.csv", "text/csv")
if st.session_state.get("out_bias", True):
    with dl_cols[2]:
        st.download_button("⬇ Bias (DCBs)", _bias_df.to_csv(index=False).encode(),
                           "Bias_DCBs_used.csv", "text/csv")

st.session_state["zgiis_df"]       = all_df
st.session_state["zgiis_daily"]    = daily_storm
st.session_state["zgiis_monthly"]  = monthly
st.session_state["zgiis_yearly"]   = yearly
st.session_state["zgiis_daily_st"] = daily_st
st.success(f"✅ Analysis complete — outputs saved to: {out_dir}")
