"""Shared dark-theme CSS injected into every ZGIIS page."""

DARK_CSS = """
<style>
/* ── Base ── */
html, body, [data-testid="stAppViewContainer"] {
    background-color: #060d1a !important;
    color: #d0dff0 !important;
}
[data-testid="stSidebar"] {
    background-color: #0d1b2a !important;
    border-right: 1px solid #1e3a5f;
}
/* sidebar base text — specific overrides below handle inputs/buttons */
[data-testid="stSidebar"] { color: #b0c8e8; }
[data-testid="stHeader"] { background: transparent !important; }

/* ── Cards ── */
.zgiis-card {
    background: #0d1b2a;
    border: 1px solid #1e3a5f;
    border-radius: 10px;
    padding: 1.1rem 1.3rem;
    margin-bottom: 0.7rem;
}
.zgiis-card-accent { border-left: 3px solid #00d4ff; }
.zgiis-card-warn   { border-left: 3px solid #ff8c00; }
.zgiis-card-alert  { border-left: 3px solid #ff4444; }
.zgiis-card-ok     { border-left: 3px solid #00ff88; }

/* ── Metric numbers ── */
.big-metric {
    font-size: 2.4rem;
    font-weight: 700;
    color: #00d4ff;
    line-height: 1.1;
}
.metric-label {
    font-size: 0.78rem;
    color: #6888aa;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}

/* ── Global page headings and subtitles ── */
h1, h2, h3, h4, h5, h6,
h1 *, h2 *, h3 *, h4 *, h5 *, h6 *,
[data-testid="stMarkdownContainer"] h1,
[data-testid="stMarkdownContainer"] h2,
[data-testid="stMarkdownContainer"] h3,
[data-testid="stMarkdownContainer"] h4,
[data-testid="stMarkdownContainer"] h5,
[data-testid="stMarkdownContainer"] h6 {
    color: #ffffff !important;
    -webkit-text-fill-color: #ffffff !important;
    opacity: 1 !important;
}
[data-testid="stMain"] [data-testid="stCaptionContainer"],
[data-testid="stMain"] [data-testid="stCaptionContainer"] *,
[data-testid="stMain"] .stCaption,
[data-testid="stMain"] .stCaption * {
    color: #ffffff !important;
    -webkit-text-fill-color: #ffffff !important;
    opacity: 1 !important;
    font-weight: 600 !important;
}
.zgiis-title {
    font-size: 2.2rem;
    font-weight: 800;
    color: #ffffff !important;
    line-height: 1.2;
}
.zgiis-title *,
.zgiis-tagline,
.zgiis-tagline * {
    color: #ffffff !important;
    -webkit-text-fill-color: #ffffff !important;
    opacity: 1 !important;
}
.zgiis-tagline {
    font-size: 0.95rem;
    font-weight: 600;
    margin-top: 0.15rem;
    margin-bottom: 0.35rem;
    line-height: 1.45;
}

/* ── Home hero layout ── */
.hero-logo-wrap {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 0.15rem;
}
.hero-logo-wrap img {
    max-width: 118px;
    margin-left: auto;
}
.hero-dashboard-panel {
    margin: 0.55rem 0 0.75rem 0;
    padding: 1.15rem 1.35rem 1.1rem;
    background: linear-gradient(155deg, rgba(13, 27, 42, 0.98), rgba(8, 18, 32, 0.94));
    border: 1px solid #1e3a5f;
    border-radius: 14px;
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.28);
}
.hero-panel-eyebrow {
    color: #00d4ff;
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-bottom: 0.85rem;
    padding-bottom: 0.55rem;
    border-bottom: 1px solid rgba(30, 58, 95, 0.55);
}
.hero-metrics-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.75rem;
    align-items: stretch;
}
.hero-metrics-grid .hero-status-card {
    margin-bottom: 0;
    background: rgba(10, 22, 40, 0.94);
    border-radius: 10px;
}

/* ── Home hero status cards ── */
.hero-status-card {
    min-height: 132px;
    padding: 0.85rem 0.65rem 0.75rem;
    margin-bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    text-align: center;
    height: 100%;
}
.hero-status-icon {
    display: block;
    font-size: 1.3rem;
    line-height: 1.2;
    margin-bottom: 0.35rem;
}
.hero-status-label {
    color: #dbeafe;
    font-size: 0.7rem;
    font-weight: 750;
    line-height: 1.3;
    min-height: 1.85rem;
    display: flex;
    align-items: center;
    justify-content: center;
}
.hero-status-value {
    margin-top: 0.25rem;
    font-size: clamp(1.25rem, 1.6vw, 1.6rem);
    font-weight: 800;
    line-height: 1.1;
}
.hero-status-note {
    margin-top: auto;
    padding-top: 0.45rem;
    color: #ffffff;
    font-size: 0.63rem;
    line-height: 1.2;
    opacity: 0.92;
}

/* ── Horizontal Kp scale (Home dashboard) ── */
.hero-scales-grid {
    display: grid;
    grid-template-columns: 10.5rem repeat(8, minmax(0, 1fr));
    gap: 0.5rem 0.4rem;
    align-items: center;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(30, 58, 95, 0.65);
}
.kp-scale-row-label {
    color: #ffffff;
    font-size: 0.64rem;
    font-weight: 800;
    line-height: 1.3;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    min-height: 3.1rem;
    padding-right: 0.35rem;
}
.kp-scale-item {
    text-align: center;
    padding: 0.2rem 0.15rem 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    min-height: 3.1rem;
}
.kp-scale-item-active .kp-scale-value {
    text-decoration: underline;
    text-underline-offset: 2px;
}
.kp-scale-value {
    font-size: 0.7rem;
    font-weight: 800;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
}
.kp-scale-label {
    margin-top: 0.1rem;
    color: #ffffff;
    font-size: 0.54rem;
    line-height: 1.15;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    opacity: 0.9;
}
.kp-scale-item-active .kp-scale-label {
    font-weight: 700;
    opacity: 1;
}
.kp-scale-color-bar {
    width: 100%;
    height: 3px;
    border-radius: 2px;
    margin-top: 0.35rem;
    opacity: 0.88;
}
.kp-scale-item-active .kp-scale-color-bar {
    height: 4px;
    opacity: 1;
    box-shadow: 0 0 8px rgba(0, 212, 255, 0.35);
}

/* ── Processing page prompt / start button spacing ── */
.proc-prompt-banner {
    background: #0d2a4a;
    border: 1px solid #1e5a8f;
    border-left: 4px solid #00d4ff;
    border-radius: 8px;
    padding: 0.75rem 1rem;
    color: #ffffff;
    font-size: 0.92rem;
    margin-bottom: 0.35rem;
}
.proc-start-gap {
    height: 1.15rem;
}

/* ── Processing pipeline stage buttons ── */
button[kind="secondary"] {
    min-height: 108px;
    white-space: pre-line !important;
    line-height: 1.35 !important;
    font-size: 0.78rem !important;
    color: #ffffff !important;
    background: #0d1b2a !important;
    border: 1px solid #1e3a5f !important;
    border-radius: 10px !important;
    font-weight: 650 !important;
}
button[kind="secondary"]:hover {
    border-color: #00d4ff !important;
    background: #102338 !important;
    color: #ffffff !important;
}

/* ── Processing pipeline explanation panel ── */
.pipeline-explain-panel {
    margin-top: 0.9rem;
    padding: 1rem 1.15rem;
    background: #0d1b2a;
    border: 1px solid #1e3a5f;
    border-left: 3px solid #00d4ff;
    border-radius: 10px;
}
.pipeline-explain-title {
    color: #ffffff;
    font-size: 1rem;
    font-weight: 800;
    margin-bottom: 0.25rem;
}
.pipeline-explain-section {
    color: #00d4ff;
    font-size: 0.78rem;
    font-weight: 700;
    margin-bottom: 0.55rem;
}
.pipeline-explain-heading {
    color: #94a3b8;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0.65rem 0 0.25rem;
}
.pipeline-explain-body {
    color: #dbeafe;
    font-size: 0.86rem;
    line-height: 1.55;
    margin: 0;
}
.pipeline-explain-cite {
    color: #6888aa;
    font-size: 0.68rem;
    line-height: 1.45;
    margin-top: 0.75rem;
    font-style: italic;
}
.pipeline-explain-panel-tail {
    margin-top: 0;
    padding-top: 0.35rem;
    border-top: none;
    border-radius: 0 0 10px 10px;
}
/* LaTeX equation blocks inside pipeline explanations */
div[data-testid="stMarkdownContainer"] h3,
div[data-testid="stMarkdownContainer"] p strong {
    color: #00d4ff !important;
    font-size: 0.76rem !important;
    font-weight: 700 !important;
}
div[data-testid="stMarkdownContainer"] div.katex-display {
    margin: 0.45rem 0 0.75rem !important;
    padding: 0.55rem 0.75rem !important;
    background: rgba(0, 0, 0, 0.28) !important;
    border-left: 2px solid #00d4ff !important;
    border-radius: 6px !important;
    overflow-x: auto !important;
}
div[data-testid="stMarkdownContainer"] .katex {
    color: #f8fbff !important;
    font-size: 1.05em !important;
}

/* ── TEC heat-map legend ── */
.tec-map-legend {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.7rem;
    margin: 0.65rem 0 0.9rem;
    padding: 0.85rem 1rem;
    width: fit-content;
    max-width: 100%;
    color: #cbd5e1;
    font-size: 0.86rem;
    background: #0d1b2a;
    border: 1px solid #1e4e78;
    border-left: 4px solid #00d4ff;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
}
.tec-map-legend-title {
    color: #ffffff;
    font-weight: 800;
    font-size: 0.86rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}
.tec-gradient {
    display: inline-block;
    width: 280px;
    height: 18px;
    border: 1px solid #5f7894;
    border-radius: 999px;
    background: linear-gradient(90deg, #000080, #0080ff, #00ff80, #ffcc00, #ff0000);
    box-shadow: 0 0 12px rgba(0, 212, 255, 0.18);
}
.tec-map-legend-note {
    flex-basis: 100%;
    margin-left: 0;
    color: #8aa6c2;
    font-size: 0.78rem;
    line-height: 1.35;
}

/* ── Status badges ── */
.badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.05em;
}
.badge-online  { background: #003322; color: #00ff88; border: 1px solid #00ff88; }
.badge-offline { background: #330011; color: #ff4444; border: 1px solid #ff4444; }
.badge-degraded{ background: #332200; color: #ff8c00; border: 1px solid #ff8c00; }
.badge-registered { background: #082f49; color: #38bdf8; border: 1px solid #38bdf8; }

/* ── Warning box ── */
.warn-box {
    background: #1a0f00;
    border: 1px solid #ff8c00;
    border-radius: 8px;
    padding: 0.7rem 1rem;
    margin: 0.4rem 0;
    color: #ffb84d;
    font-size: 0.88rem;
}
.alert-box {
    background: #1a0005;
    border: 1px solid #ff4444;
    border-radius: 8px;
    padding: 0.7rem 1rem;
    margin: 0.4rem 0;
    color: #ff8888;
    font-size: 0.88rem;
}
.ok-box {
    background: #001a0e;
    border: 1px solid #00ff88;
    border-radius: 8px;
    padding: 0.7rem 1rem;
    margin: 0.4rem 0;
    color: #ffffff;
    font-size: 0.88rem;
}

/* ── Plotly / chart backgrounds ── */
.js-plotly-plot .plotly { background: transparent !important; }

/* ── Streamlit elements ── */
[data-testid="stMetricValue"] { color: #00d4ff !important; font-weight: 700; }
[data-testid="stMetricLabel"],
[data-testid="stMetricLabel"] p,
[data-testid="stMetricLabel"] span,
[data-testid="stMetricLabel"] div {
    color: #ffffff !important;
    font-weight: 600 !important;
    font-size: 0.95rem !important;
}
button[kind="primary"],
button[kind="primary"] p,
button[kind="primary"] span,
button[kind="primary"] * {
    background: linear-gradient(90deg, #004466, #006688) !important;
    border: 1px solid #00d4ff !important;
    color: #ffffff !important;
    -webkit-text-fill-color: #ffffff !important;
}

/* ── Sidebar input text & labels ── */
/* Labels above inputs */
[data-testid="stSidebar"] label,
[data-testid="stSidebar"] .stTextInput label,
[data-testid="stSidebar"] .stNumberInput label,
[data-testid="stSidebar"] .stMultiSelect label,
[data-testid="stSidebar"] .stSelectbox label,
[data-testid="stSidebar"] .stRadio label,
[data-testid="stSidebar"] .stCheckbox label p {
    color: #c8dcf0 !important;
    font-weight: 600 !important;
}

/* Typed text inside text inputs and number inputs */
[data-testid="stSidebar"] input[type="text"],
[data-testid="stSidebar"] input[type="number"],
[data-testid="stSidebar"] textarea {
    color: #ffffff !important;
    background-color: #0a1e33 !important;
    border: 1px solid #2a5080 !important;
    caret-color: #00d4ff !important;
}

/* Placeholder text in inputs */
[data-testid="stSidebar"] input::placeholder,
[data-testid="stSidebar"] textarea::placeholder {
    color: #5577aa !important;
}

/* Select all / Clear all buttons — reset pipeline overrides, keep compact */
[data-testid="stSidebar"] button[kind="secondary"],
[data-testid="stSidebar"] button:not([kind="primary"]) {
    min-height: unset !important;
    height: auto !important;
    white-space: nowrap !important;
    background-color: #0a2040 !important;
    border: 1px solid #2a5080 !important;
    color: #e0f0ff !important;
    font-weight: 600 !important;
    font-size: 0.78rem !important;
    padding: 0.3rem 0.6rem !important;
    line-height: 1.3 !important;
}
[data-testid="stSidebar"] button[kind="secondary"]:hover,
[data-testid="stSidebar"] button:not([kind="primary"]):hover {
    background-color: #0d3060 !important;
    border-color: #00d4ff !important;
    color: #00d4ff !important;
}

/* Multiselect box — the container */
[data-testid="stSidebar"] [data-baseweb="select"] > div {
    background-color: #0a1e33 !important;
    border: 1px solid #2a5080 !important;
}
/* Multiselect typed search text */
[data-testid="stSidebar"] [data-baseweb="select"] input {
    color: #ffffff !important;
}
/* Multiselect placeholder */
[data-testid="stSidebar"] [data-baseweb="select"] [data-testid="stMultiSelectPlaceholder"],
[data-testid="stSidebar"] [data-baseweb="select"] span {
    color: #7799bb !important;
}
/* Selected tags (pills) inside multiselect */
[data-testid="stSidebar"] [data-baseweb="tag"] {
    background-color: #003355 !important;
    border: 1px solid #00d4ff !important;
}
[data-testid="stSidebar"] [data-baseweb="tag"] span {
    color: #e0f8ff !important;
    font-weight: 600 !important;
}
/* Tag × close button */
[data-testid="stSidebar"] [data-baseweb="tag"] [role="button"] svg {
    fill: #7bbcdd !important;
}

/* Number input +/- buttons */
[data-testid="stSidebar"] [data-testid="stNumberInputStepDown"],
[data-testid="stSidebar"] [data-testid="stNumberInputStepUp"] {
    color: #00d4ff !important;
    background-color: #0a2040 !important;
}

/* Checkbox and radio text */
[data-testid="stSidebar"] .stCheckbox span,
[data-testid="stSidebar"] .stRadio span {
    color: #c8dcf0 !important;
}

/* Caption / small helper text */
[data-testid="stSidebar"] small,
[data-testid="stSidebar"] .stCaption,
[data-testid="stSidebar"] [data-testid="stCaptionContainer"] {
    color: #5588aa !important;
}

/* Output file checkboxes — hide the generated label, keep tick box visible */
[data-testid="stSidebar"] .stCheckbox [data-testid="stWidgetLabel"] {
    display: none;
}
[data-testid="stSidebar"] .stCheckbox input[type="checkbox"] {
    accent-color: #00cc55;
    width: 16px;
    height: 16px;
}

/* ── Footer ── */
.zgiis-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 9999;
    background: #060d1a;
    border-top: 1px solid #1e3a5f;
    padding: 0.45rem 1.5rem;
    text-align: center;
    font-size: 0.72rem;
    color: #ffffff;
    letter-spacing: 0.04em;
}
.zgiis-footer span {
    color: #ffffff;
    font-weight: 700;
}
/* push page content up so footer doesn't overlap last element */
[data-testid="stAppViewContainer"] > section:first-child {
    padding-bottom: 2.5rem;
}
</style>
"""

_FOOTER_HTML = """
<div class="zgiis-footer">
    &copy; 2026 <span>Zimbabwe National Geospatial and Space Agency (ZINGSA)</span>
    &nbsp;&mdash;&nbsp; All rights reserved
</div>
"""


def inject(st_instance) -> None:
    """Call this once per page after set_page_config."""
    st_instance.markdown(DARK_CSS, unsafe_allow_html=True)
    st_instance.markdown(_FOOTER_HTML, unsafe_allow_html=True)
