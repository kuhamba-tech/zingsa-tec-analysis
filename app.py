from __future__ import annotations

import re
import sys
from pathlib import Path

import pandas as pd
import plotly.express as px

# Compatibility shim: ensure Starlette's gzip module exposes symbols
# Streamlit expects `DEFAULT_EXCLUDED_CONTENT_TYPES` and `IdentityResponder`.
try:
    import starlette.middleware.gzip as _sgzip
    if not hasattr(_sgzip, "DEFAULT_EXCLUDED_CONTENT_TYPES"):
        _sgzip.DEFAULT_EXCLUDED_CONTENT_TYPES = ("text/", "application/")
    if not hasattr(_sgzip, "IdentityResponder"):
        if hasattr(_sgzip, "GZipResponder"):
            class IdentityResponder(_sgzip.GZipResponder):
                pass

            _sgzip.IdentityResponder = IdentityResponder
except Exception:
    pass

import streamlit as st

APP_VERSION = "2026-06-02-r3"

DEFAULT_DATA_ROOT = r"C:\Users\Tapiwa\Documents\Timothy\ZINGSA\Space Science\TEC ANAlYSIS"

project_root = Path(__file__).resolve().parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

# Force reload of local module (avoids stale Streamlit/Python cache).
if "tec_core" in sys.modules:
    del sys.modules["tec_core"]

from tec_core import (
    TecConfig,
    add_storm_intensity_index,
    combine_sources,
    mark_storm_days,
    read_cmn_file,
    read_cmn_folder,
    read_kp_csv,
    read_rinex_files,
    summarize_daily,
    summarize_daily_by_station,
    summarize_24h_profile,
    summarize_monthly,
    summarize_yearly,
)

ZIM_CORS_STATIONS = {
    "cent": "Centenary",
    "chim": "Chimanimani",
    "chir": "Chiredzi",
    "gokw": "Gokwe",
    "gsu": "Gwanda",
    "hara": "Harare",
    "karo": "Karoi",
    "kwek": "Kwekwe",
    "lupa": "Lupane",
    "zinh": "ZINH",
    "bula": "Bulawayo",
    "gwer": "Gweru",
}


def parse_cmn_date(path: Path) -> pd.Timestamp | None:
    match = re.search(r"(\d{4}-\d{2}-\d{2})", path.stem)
    if not match:
        return None
    ts = pd.to_datetime(match.group(1), errors="coerce")
    return None if pd.isna(ts) else pd.Timestamp(ts)


def parse_rinex_obs_date(path: Path) -> pd.Timestamp | None:
    # GOP-style files like karo1140.24o -> DOY 114, year 2024
    name = path.name.lower()
    match = re.search(r"([a-z0-9_]+)(\d{3})0\.(\d{2})o$", name)
    if not match:
        return None
    doy = int(match.group(2))
    year = 2000 + int(match.group(3))
    ts = pd.Timestamp(year=year, month=1, day=1) + pd.to_timedelta(doy - 1, unit="D")
    return None if pd.isna(ts) else pd.Timestamp(ts)


def keep_by_mode(
    file_date: pd.Timestamp | None,
    mode: str,
    day_value,
    month_value,
    year_value: int,
) -> bool:
    if file_date is None or pd.isna(file_date):
        return mode == "Directory"
    fdate = pd.Timestamp(file_date).floor("D")
    if mode == "This Day only":
        return fdate == pd.Timestamp(day_value)
    if mode == "This Month":
        return fdate.to_period("M") == pd.Timestamp(month_value).to_period("M")
    if mode == "This Year":
        return int(fdate.year) == int(year_value)
    return True


def browse_folder_dialog(initial_dir: str | None = None) -> str | None:
    """Open native Windows folder picker (GOP-style Browse)."""
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        start = initial_dir if initial_dir and Path(initial_dir).exists() else str(Path.home())
        selected = filedialog.askdirectory(
            title="Browse - Select folder (RINEX / CMN data)",
            initialdir=start,
        )
        root.destroy()
        return selected or None
    except Exception as exc:
        st.warning(f"Folder browser unavailable: {exc}")
        return None


def browse_obs_files_dialog(initial_dir: str | None = None) -> list[str]:
    """Open native Windows file picker with Obs/All dropdown (GOP-like)."""
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        start = initial_dir if initial_dir and Path(initial_dir).exists() else str(Path.home())
        selected = filedialog.askopenfilenames(
            title="Browse - Rinex/Novatel/Leica data files",
            initialdir=start,
            filetypes=[
                (
                    "Obs files",
                    "*.o;*.O;*.obs;*.OBS;*.rnx;*.24o;*.24n;*.24g;*.24O;*.24N;*.24G",
                ),
                ("All files", "*.*"),
            ],
        )
        root.destroy()
        return list(selected)
    except Exception as exc:
        st.warning(f"Obs file browser unavailable: {exc}")
        return []


def list_folder_files(folder: Path, patterns: tuple[str, ...], limit: int = 200) -> list[str]:
    """Return a list of matching file paths (full paths) under `folder`.

    Returns up to `limit` entries as strings.
    """
    files: list[Path] = []
    for pattern in patterns:
        files.extend(sorted(folder.glob(pattern)))
        if len(files) >= limit:
            break
    # Return sorted unique full paths as strings
    names = sorted({str(p) for p in files})[:limit]
    return names


st.set_page_config(page_title="GNSS TEC Analyzer", layout="wide")
st.title("GNSS TEC Analyzer (CMN / RINEX)")
st.caption(
    f"Python replacement for MATLAB TEC workflow | build {APP_VERSION} | "
    f"module: {project_root / 'tec_core.py'}"
)

with st.sidebar:
    st.header("Inputs (GOP-style)")

    if "data_folder" not in st.session_state:
        st.session_state.data_folder = DEFAULT_DATA_ROOT

    b1, b2 = st.columns([1, 1])
    with b1:
        if st.button("Browse folder...", use_container_width=True):
            picked = browse_folder_dialog(st.session_state.data_folder)
            if picked:
                st.session_state.data_folder = picked
                st.rerun()
    with b2:
        if st.button("Refresh list", use_container_width=True):
            st.rerun()

    if "selected_obs_files" not in st.session_state:
        st.session_state.selected_obs_files = []
    if st.button("Browse obs files...", use_container_width=True):
        picked_files = browse_obs_files_dialog(st.session_state.data_folder)
        if picked_files:
            st.session_state.selected_obs_files = picked_files
            st.rerun()

    data_folder = st.text_input(
        "Folder to process",
        value=st.session_state.data_folder,
        help="Click Browse folder... to open the Windows folder dialog (like GOP).",
    )
    st.session_state.data_folder = data_folder

    folder_preview = Path(data_folder)
    if folder_preview.exists() and folder_preview.is_dir():
        cmn_n = len(list(folder_preview.rglob("*.Cmn")) + list(folder_preview.rglob("*.cmn")))
        obs_n = len(
            list(folder_preview.rglob("*.o"))
            + list(folder_preview.rglob("*.O"))
            + list(folder_preview.rglob("*.24o"))
            + list(folder_preview.rglob("*.24n"))
            + list(folder_preview.rglob("*.24g"))
        )
        st.caption(f"Selected: `{folder_preview}`")
        st.caption(
            f"Total file(s) found # {obs_n} obs (`*.o`, `*.24o`, `*.24n`, `*.24g`) | {cmn_n} CMN (folder + subfolders)"
        )
        if st.session_state.selected_obs_files:
            st.caption(f"Obs files selected from dialog: {len(st.session_state.selected_obs_files)}")
            # Show full selected file paths in a scrollable box so users can see
            # exactly which files were picked by the native file dialog.
            st.text_area(
                "Selected obs files",
                value="\n".join(st.session_state.selected_obs_files),
                height=140,
            )
        with st.expander("View files in folder", expanded=False):
            preview = list_folder_files(
                folder_preview,
                ("*.Cmn", "*.cmn", "*.o", "*.O", "*.24o", "*.24n", "*.24g"),
                limit=80,
            )
            if preview:
                st.text("\n".join(preview))
            else:
                st.text("(no CMN/RINEX files in this folder)")
    else:
        st.warning("Folder path does not exist yet. Use Browse folder...")

    parent = folder_preview.parent if folder_preview.exists() else Path(DEFAULT_DATA_ROOT)
    quick_dirs = [str(parent)]
    if parent.exists():
        quick_dirs.extend(sorted(str(p) for p in parent.iterdir() if p.is_dir())[:30])
    quick_pick = st.selectbox(
        "Quick jump (subfolders)",
        options=quick_dirs,
        index=quick_dirs.index(str(folder_preview)) if str(folder_preview) in quick_dirs else 0,
    )
    if quick_pick != st.session_state.data_folder:
        st.session_state.data_folder = quick_pick
    data_folder = st.session_state.data_folder
    processing_mode = st.radio(
        "Processing mode",
        options=["This Day only", "This Month", "This Year", "Directory"],
        index=1,
    )
    mode_day = st.date_input("Target day", value=pd.Timestamp.today().date()) if processing_mode == "This Day only" else None
    mode_month = (
        st.date_input("Target month (pick any date in month)", value=pd.Timestamp.today().date())
        if processing_mode == "This Month"
        else None
    )
    mode_year = (
        st.number_input("Target year", min_value=2000, max_value=2100, value=int(pd.Timestamp.today().year), step=1)
        if processing_mode == "This Year"
        else int(pd.Timestamp.today().year)
    )
    all_stations = st.checkbox("Is all stations", value=True)
    cors_station_options = [f"{k} - {v}" for k, v in sorted(ZIM_CORS_STATIONS.items())]
    selected_cors_labels = st.multiselect(
        "Zimbabwe CORS stations (optional)",
        options=cors_station_options,
        default=[],
        help="Select one or more Zimbabwe CORS stations to process.",
    )
    load_cmn = st.checkbox("Load CMN files", value=True)
    load_rinex = st.checkbox("Load RINEX files (optional)", value=False)
    elevation_min = st.number_input("Minimum elevation (deg)", min_value=0.0, max_value=90.0, value=25.0, step=1.0)
    ipp_h = st.number_input("IPP shell height (km, for RINEX->VTEC)", min_value=250.0, max_value=600.0, value=350.0)
    kp_csv_path = st.text_input("KP index CSV path (optional)", value="")
    run_btn = st.button("Run analysis", type="primary")

if not run_btn:
    st.info("Set inputs, then click **Run analysis**.")
    st.stop()

folder = Path(data_folder)
if not folder.exists():
    st.error(f"Folder not found: {folder}")
    st.stop()

cfg = TecConfig(elevation_min_deg=float(elevation_min), ipp_height_km=float(ipp_h))

st.subheader("Open files (similar to GOP open/select behavior)")
cmn_paths = []
if load_cmn:
    all_cmn_paths = sorted(folder.rglob("*.Cmn")) + sorted(folder.rglob("*.cmn"))
    all_cmn_paths = [
        p
        for p in all_cmn_paths
        if keep_by_mode(parse_cmn_date(p), processing_mode, mode_day, mode_month, mode_year)
    ]
    cmn_names = [str(p.relative_to(folder)) for p in all_cmn_paths]
    st.write(f"Detected CMN files for mode '{processing_mode}': **{len(cmn_names)}**")

    select_mode = st.radio(
        "CMN selection mode",
        options=["Auto by processing mode", "Manual file selection"],
        index=0,
        horizontal=True,
    )

    if select_mode == "Manual file selection":
        selected_rel = st.multiselect(
            "Select CMN files to open",
            options=cmn_names,
            default=cmn_names[: min(15, len(cmn_names))],
        )
        cmn_paths = [folder / rel for rel in selected_rel]
    else:
        cmn_paths = all_cmn_paths

rinex_paths = []
if load_rinex:
    # Priority 1: explicit file selection via GOP-like file dialog
    selected_obs_files = [Path(p) for p in st.session_state.get("selected_obs_files", []) if Path(p).exists()]
    if selected_obs_files:
        rinex_paths = selected_obs_files
        st.write(f"Using selected obs file(s): **{len(rinex_paths)}**")
    
    o_files = sorted(folder.rglob("*.o")) + sorted(folder.rglob("*.O"))
    other_obs = sorted(folder.rglob("*.obs")) + sorted(folder.rglob("*.rnx"))
    all_obs = o_files + other_obs
    all_obs = [
        p
        for p in all_obs
        if keep_by_mode(parse_rinex_obs_date(p), processing_mode, mode_day, mode_month, mode_year)
    ]
    rinex_names = [str(p.relative_to(folder)) for p in all_obs]
    o_names = [str(p.relative_to(folder)) for p in o_files if keep_by_mode(parse_rinex_obs_date(p), processing_mode, mode_day, mode_month, mode_year)]
    st.write(f"Detected obs (`*.o`/`*.O`) for mode '{processing_mode}': **{len(o_names)}**")
    if other_obs:
        st.caption(f"Other RINEX formats detected in folder (optional): {len(other_obs)} (may be ignored if `*.o` exists)")

    # GOP-like triplet check for classic RINEX 2 naming (.24o/.24n/.24g)
    triplet_ok = 0
    for obs in all_obs:
        n_file = Path(str(obs)[:-1] + "n") if str(obs).lower().endswith("o") else None
        g_file = Path(str(obs)[:-1] + "g") if str(obs).lower().endswith("o") else None
        has_nav = (n_file is not None and n_file.exists()) or (g_file is not None and g_file.exists())
        if has_nav:
            triplet_ok += 1
    st.caption(f"G/N/O compatibility check: {triplet_ok}/{len(all_obs)} obs files have a matching .n or .g file.")

    rinex_select_mode = st.radio(
        "RINEX selection mode",
        options=["Auto by processing mode", "Manual file selection", "Use selected obs from Browse dialog"],
        index=0,
        horizontal=True,
    )
    if rinex_select_mode == "Use selected obs from Browse dialog":
        rinex_paths = selected_obs_files
    elif rinex_select_mode == "Manual file selection":
        # GOP screenshot behavior: select primarily from *.o files
        selection_options = o_names if o_names else rinex_names
        selected_obs = st.multiselect(
            "Select RINEX obs (`.o` files) to open",
            options=selection_options,
            default=selection_options[: min(15, len(selection_options))],
        )
        selected_obs_set = set(selected_obs)
        cmn_selected = [folder / rel for rel in selected_obs_set]
        rinex_paths = cmn_selected
    else:
        # Auto mode: use filtered *.o files if any; otherwise all supported obs.
        auto_options = o_files if o_files else all_obs
        auto_options = [
            p
            for p in auto_options
            if keep_by_mode(parse_rinex_obs_date(p), processing_mode, mode_day, mode_month, mode_year)
        ]
        rinex_paths = auto_options

with st.spinner("Loading and processing data..."):
    cmn_df = pd.DataFrame()
    if load_cmn:
        if cmn_paths:
            cmn_frames = [read_cmn_file(path, cfg) for path in cmn_paths]
            cmn_df = pd.concat(cmn_frames, ignore_index=True) if cmn_frames else pd.DataFrame()
        else:
            cmn_df = read_cmn_folder(folder, cfg)

    rinex_df = pd.DataFrame()
    if load_rinex:
        try:
            rinex_df = read_rinex_files(rinex_paths, cfg) if rinex_paths else pd.DataFrame()
        except Exception as exc:
            st.warning(f"RINEX parsing skipped: {exc}")

    all_df = combine_sources(cmn_df=cmn_df, rinex_df=rinex_df)

if all_df.empty:
    st.warning("No valid TEC rows found. Check files and filters.")
    st.stop()

all_df["date"] = pd.to_datetime(all_df["date"]).dt.floor("D")
all_df["station"] = all_df["station"].astype(str).str.lower()
stations = sorted(x for x in all_df["station"].dropna().unique())

selected_cors_codes = [label.split(" - ")[0].strip().lower() for label in selected_cors_labels]
if selected_cors_codes:
    all_df = all_df[all_df["station"].isin(selected_cors_codes)].copy()
    if all_df.empty:
        st.warning("No rows found for selected Zimbabwe CORS stations.")
        st.stop()
    selected_names = [ZIM_CORS_STATIONS.get(code, code.upper()) for code in selected_cors_codes]
    st.info(f"Selected Zimbabwe CORS station(s): {', '.join(selected_names)}")
elif not all_stations:
    # Keep existing behavior when "Is all stations" is disabled and no CORS list is chosen.
    pass

col1, col2 = st.columns([1, 1])
with col1:
    station_sel = st.multiselect("Station filter", options=stations, default=stations)
with col2:
    granularity = st.selectbox("Analysis window", options=["Day", "Month", "Year"], index=1)

if station_sel and not all_stations:
    all_df = all_df[all_df["station"].isin(station_sel)].copy()

min_date = all_df["date"].min().date()
max_date = all_df["date"].max().date()

if processing_mode == "This Day only":
    one_day = st.date_input("Select day", value=min_date, min_value=min_date, max_value=max_date)
    all_df = all_df[all_df["date"] == pd.Timestamp(one_day)]
elif processing_mode == "This Month":
    all_df["month"] = pd.to_datetime(all_df["date"]).dt.to_period("M").astype(str)
    month_options = sorted(all_df["month"].unique())
    selected_month = st.selectbox("Select month", options=month_options, index=len(month_options) - 1)
    all_df = all_df[all_df["month"] == selected_month]
elif processing_mode == "This Year":
    all_df["year"] = pd.to_datetime(all_df["date"]).dt.year
    year_options = sorted(all_df["year"].unique())
    selected_year = st.selectbox("Select year", options=year_options, index=len(year_options) - 1)
    all_df = all_df[all_df["year"] == selected_year]
else:
    date_range = st.date_input("Directory date range", value=(min_date, max_date), min_value=min_date, max_value=max_date)
    if isinstance(date_range, tuple) and len(date_range) == 2:
        start_d, end_d = date_range
        all_df = all_df[(all_df["date"] >= pd.Timestamp(start_d)) & (all_df["date"] <= pd.Timestamp(end_d))]

all_df["month"] = pd.to_datetime(all_df["date"]).dt.to_period("M").astype(str)
month_options = sorted(all_df["month"].unique())
selected_months = st.multiselect("Month selector (quick filter)", options=month_options, default=month_options)
if selected_months:
    all_df = all_df[all_df["month"].isin(selected_months)].copy()

all_df["year"] = pd.to_datetime(all_df["date"]).dt.year
year_options = sorted(all_df["year"].unique())
selected_years = st.multiselect("Year selector (quick filter)", options=year_options, default=year_options)
if selected_years:
    all_df = all_df[all_df["year"].isin(selected_years)].copy()

if all_df.empty:
    st.warning("No rows left after month/year/station filtering.")
    st.stop()

daily = summarize_daily(all_df)
kp_df = None
if kp_csv_path.strip():
    try:
        kp_df = read_kp_csv(Path(kp_csv_path.strip()))
    except Exception as exc:
        st.warning(f"KP CSV not loaded: {exc}")

daily_storm = mark_storm_days(daily, kp_df=kp_df)
monthly = summarize_monthly(daily)
yearly = summarize_yearly(daily)
daily_station = summarize_daily_by_station(all_df)
daily_station = add_storm_intensity_index(daily_station)

st.subheader("Key metrics")
m1, m2, m3, m4 = st.columns(4)
m1.metric("Filtered rows", f"{len(all_df):,}")
m2.metric("Mean VTEC", f"{all_df['vtec'].mean():.2f}")
m3.metric("Max VTEC", f"{all_df['vtec'].max():.2f}")
m4.metric("Storm days", int(daily_storm["storm_flag"].sum()))

st.subheader("Daily TEC and storm signatures")
st.caption(
    "Official storm decision: NOAA Kp ≥ 5 (G1–G5). There is no official "
    "universal TECU storm threshold. TEC response is measured against the "
    "previous 27 days of Kp-confirmed quiet observations (Kp < 4), requiring "
    "at least 10 quiet days."
)
if len(daily) < 10:
    kp_note = (
        " Kp-based detection remains active for dates with supplied Kp data."
        if kp_df is not None and not kp_df.empty
        else " No Kp data is loaded, so no storm classification is made."
    )
    st.info(
        f"TEC anomaly detection requires at least 10 valid daily observations; "
        f"{len(daily)} loaded.{kp_note}"
    )
fig_daily = px.line(daily_storm, x="date", y="mean_vtec", title="Daily mean VTEC")
storm_pts = daily_storm[daily_storm["storm_flag"]]
if not storm_pts.empty:
    fig_daily.add_scatter(
        x=storm_pts["date"],
        y=storm_pts["mean_vtec"],
        mode="markers",
        marker={"size": 10, "color": "red"},
        name="Potential storm/anomaly day",
    )
st.plotly_chart(fig_daily, use_container_width=True)

st.subheader("GOP-style daily TEC plots")
g1, g2 = st.columns(2)
with g1:
    gop_station = st.selectbox("GOP plot station", options=sorted(all_df["station"].unique()))
with g2:
    gop_date_options = sorted(pd.to_datetime(all_df["date"]).dt.date.unique())
    gop_date = st.selectbox("GOP plot date", options=gop_date_options, index=len(gop_date_options) - 1)

gop_df = all_df[
    (all_df["station"] == gop_station)
    & (pd.to_datetime(all_df["date"]).dt.date == gop_date)
].copy()

if gop_df.empty:
    st.info("No data for selected station/date to draw GOP-style plots.")
else:
    gop_df["ut_hour"] = (
        pd.to_datetime(gop_df["timestamp"]).dt.hour
        + pd.to_datetime(gop_df["timestamp"]).dt.minute / 60.0
        + pd.to_datetime(gop_df["timestamp"]).dt.second / 3600.0
    )
    gop_df = gop_df.sort_values(["prn", "ut_hour"])

    # Left plot: PRN traces with elevation mask caption.
    fig_left = px.line(
        gop_df,
        x="ut_hour",
        y="vtec",
        color="prn",
        title=f"Calculated TEC - Elevation Mask {int(elevation_min)} deg",
    )
    fig_left.update_layout(xaxis_title="UT (hrs)", yaxis_title="TEC units")

    # Right plot: mean profile across PRNs (used as bias-removed style summary view).
    prof = (
        gop_df.groupby("ut_hour", as_index=False)
        .agg(vtec_mean=("vtec", "mean"))
        .sort_values("ut_hour")
    )
    fig_right = px.line(
        prof,
        x="ut_hour",
        y="vtec_mean",
        title="Calculated TEC (Satellite & Rx bias(es) removed)",
    )
    fig_right.update_layout(xaxis_title="UT (hrs)", yaxis_title="TEC units")

    c1, c2 = st.columns(2)
    with c1:
        st.plotly_chart(fig_left, use_container_width=True)
    with c2:
        st.plotly_chart(fig_right, use_container_width=True)

if granularity == "Day":
    st.subheader("Day view")
    st.dataframe(daily_storm, use_container_width=True)
elif granularity == "Month":
    st.subheader("Month view")
    fig_month = px.bar(monthly, x="month", y="mean_vtec", title="Monthly mean VTEC")
    st.plotly_chart(fig_month, use_container_width=True)
    st.dataframe(monthly, use_container_width=True)
else:
    st.subheader("Year view")
    fig_year = px.bar(yearly, x="year", y="mean_vtec", title="Yearly mean VTEC")
    st.plotly_chart(fig_year, use_container_width=True)
    st.dataframe(yearly, use_container_width=True)

st.subheader("KP relationship (if KP provided)")
if daily_storm["kp_index"].notna().any():
    fig_kp = px.scatter(
        daily_storm.dropna(subset=["kp_index"]),
        x="kp_index",
        y="mean_vtec",
        trendline="ols",
        title="Mean VTEC vs KP index",
    )
    st.plotly_chart(fig_kp, use_container_width=True)
else:
    st.info("Provide KP CSV to analyze TEC vs KP relationship.")

st.subheader("GOP-compatible monthly report (creative space-weather mode)")
if daily_station.empty:
    st.info("No station-level daily summary available.")
else:
    month_choices = sorted(pd.to_datetime(daily_station["date"]).dt.to_period("M").astype(str).unique())
    report_month = st.selectbox("Report month", options=month_choices, index=len(month_choices) - 1)
    report_station = st.selectbox("Report station", options=sorted(daily_station["station"].unique()))
    report_df = daily_station[
        (daily_station["station"] == report_station)
        & (pd.to_datetime(daily_station["date"]).dt.to_period("M").astype(str) == report_month)
    ].copy()
    report_df = report_df.sort_values("date")

    if report_df.empty:
        st.warning("No records for selected station/month.")
    else:
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Month mean TEC", f"{report_df['mean_vtec'].mean():.2f}")
        c2.metric("Month max TEC", f"{report_df['max_vtec'].max():.2f}")
        c3.metric("Month min TEC", f"{report_df['min_vtec'].min():.2f}")
        c4.metric("Strong-storm days", int((report_df["storm_class"] == "Strong Storm").sum()))

        fig_r1 = px.line(report_df, x="date", y="mean_vtec", markers=True, title="Mean VTEC (24h)")
        fig_r2 = px.line(report_df, x="date", y="max_vtec", markers=True, title="Maximum VTEC")
        fig_r3 = px.line(report_df, x="date", y="min_vtec", markers=True, title="Minimum VTEC")
        fig_r4 = px.line(report_df, x="date", y="daytime_mean_vtec", markers=True, title="6AM-6PM Mean VTEC")
        st.plotly_chart(fig_r1, use_container_width=True)
        st.plotly_chart(fig_r2, use_container_width=True)
        st.plotly_chart(fig_r3, use_container_width=True)
        st.plotly_chart(fig_r4, use_container_width=True)

        fig_si = px.bar(
            report_df,
            x="date",
            y="storm_intensity",
            color="storm_class",
            title="Storm intensity index (TEC-based)",
        )
        st.plotly_chart(fig_si, use_container_width=True)
        st.dataframe(
            report_df[
                [
                    "date",
                    "mean_vtec",
                    "max_vtec",
                    "min_vtec",
                    "daytime_mean_vtec",
                    "storm_intensity",
                    "storm_class",
                ]
            ],
            use_container_width=True,
        )

        st.subheader("GOP-like 24-hour TEC profile for selected month")
        profile_scope = st.selectbox(
            "24-hour profile scope",
            options=["Selected month", "All selected dates"],
            index=0,
        )
        if profile_scope == "Selected month":
            df_profile_src = all_df[
                (all_df["station"] == report_station.lower())
                & (all_df["month"] == report_month)
            ].copy()
        else:
            df_profile_src = all_df[all_df["station"] == report_station.lower()].copy()
        if df_profile_src.empty:
            st.info("Not enough CMN data for this station/month to build a 24-hour profile.")
        else:
            prof = summarize_24h_profile(df_profile_src)
            fig_prof = px.line(
                prof,
                x="ut_hour",
                y="mean_vtec",
                title="Monthly Mean VTEC (24h profile)",
            )
            fig_prof.add_scatter(
                x=prof["ut_hour"],
                y=prof["max_vtec"],
                mode="lines",
                line={"width": 1, "color": "rgba(255, 0, 0, 0.45)"},
                name="Monthly Max (across days)",
            )
            fig_prof.add_scatter(
                x=prof["ut_hour"],
                y=prof["min_vtec"],
                mode="lines",
                line={"width": 1, "color": "rgba(0, 0, 255, 0.45)"},
                name="Monthly Min (across days)",
            )
            st.plotly_chart(fig_prof, use_container_width=True)

st.subheader("Exports")
out_dir = folder / "tec_python_outputs"
out_dir.mkdir(exist_ok=True)
daily_path = out_dir / "daily_summary.csv"
monthly_path = out_dir / "monthly_summary.csv"
yearly_path = out_dir / "yearly_summary.csv"
filtered_path = out_dir / "filtered_observations.csv"
time_elev_vtec_path = out_dir / "time_elevation_vtec.csv"
daily_station_path = out_dir / "daily_station_report.csv"
daily_storm.to_csv(daily_path, index=False)
monthly.to_csv(monthly_path, index=False)
yearly.to_csv(yearly_path, index=False)
all_df.to_csv(filtered_path, index=False)
all_df[["timestamp", "station", "prn", "elevation", "vtec", "source_file"]].to_csv(time_elev_vtec_path, index=False)
daily_station.to_csv(daily_station_path, index=False)
st.success(f"Saved outputs to: {out_dir}")
st.write(
    {
        "daily_summary": str(daily_path),
        "monthly_summary": str(monthly_path),
        "yearly_summary": str(yearly_path),
        "filtered_rows": str(filtered_path),
        "time_elevation_vtec": str(time_elev_vtec_path),
        "daily_station_report": str(daily_station_path),
    }
)
