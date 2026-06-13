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

/* ── Headings ── */
h1, h2, h3, h4, h5, h6 { color: #ffffff !important; }
[data-testid="stMarkdownContainer"] h1,
[data-testid="stMarkdownContainer"] h2,
[data-testid="stMarkdownContainer"] h3 { color: #ffffff !important; }
.zgiis-title {
    font-size: 2.2rem;
    font-weight: 800;
    background: linear-gradient(90deg, #00d4ff, #00ff88);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    line-height: 1.2;
}
.zgiis-tagline { color: #5588bb; font-size: 1rem; margin-top: -0.3rem; }

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
    color: #66ffbb;
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
button[kind="primary"] {
    background: linear-gradient(90deg, #004466, #006688) !important;
    border: 1px solid #00d4ff !important;
    color: #00d4ff !important;
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

/* Select all / Clear all buttons */
[data-testid="stSidebar"] button[kind="secondary"],
[data-testid="stSidebar"] button:not([kind="primary"]) {
    background-color: #0a2040 !important;
    border: 1px solid #2a5080 !important;
    color: #e0f0ff !important;
    font-weight: 600 !important;
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
</style>
"""


def inject(st_instance) -> None:
    """Call this once per page after set_page_config."""
    st_instance.markdown(DARK_CSS, unsafe_allow_html=True)
