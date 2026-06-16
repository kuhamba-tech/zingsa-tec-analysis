"""Shared dark-theme CSS injected into every ZGIIS page."""

DARK_CSS = """
<style>
/* ── Base ── */
html, body,
[data-testid="stAppViewContainer"],
[data-testid="stMain"],
[data-testid="stMainBlockContainer"],
section[data-testid="stMain"] {
    background-color: #000000 !important;
    color: #ffffff !important;
}
[data-testid="stSidebar"] {
    background: #000000 !important;
    border-right: 10px solid #17367a;
}
/* sidebar base text */
[data-testid="stSidebar"] { color: #ffffff; }
[data-testid="stHeader"] { background: transparent !important; }

/* Sidebar navigation uses the ZINGSA logo blues. */
[data-testid="stSidebar"] [data-testid="stPageLink-NavLink"],
[data-testid="stSidebar"] a[href] {
    border: 1px solid transparent !important;
    border-radius: 7px !important;
    color: #ffffff !important;
}
[data-testid="stSidebar"] [data-testid="stPageLink-NavLink"]:hover,
[data-testid="stSidebar"] a[href]:hover {
    background-color: rgba(22, 139, 210, 0.16) !important;
    border-color: rgba(22, 139, 210, 0.45) !important;
}
[data-testid="stSidebar"] [data-testid="stPageLink-NavLink"][aria-current="page"],
[data-testid="stSidebar"] a[href][aria-current="page"] {
    background: #17367a !important;
    border-color: #168bd2 !important;
    box-shadow: inset 3px 0 0 #63c7ff, 0 3px 12px rgba(0, 0, 0, 0.24);
}
[data-testid="stSidebar"] [aria-current="page"] p,
[data-testid="stSidebar"] [aria-current="page"] span {
    color: #ffffff !important;
    font-weight: 750 !important;
}
[data-testid="stSidebar"] hr {
    border-color: rgba(255, 255, 255, 0.35) !important;
}

/* ── Cards ── */
.zgiis-card {
    background: #000000;
    border: 1px solid #244d73;
    border-radius: 10px;
    padding: 1.1rem 1.3rem;
    margin-bottom: 0.7rem;
}
.zgiis-card-accent { border-left: 3px solid #168bd2; }
.zgiis-card-warn   { border-left: 3px solid #ff8c00; }
.zgiis-card-alert  { border-left: 3px solid #ff4444; }
.zgiis-card-ok     { border-left: 3px solid #00ff88; }

/* ── Metric numbers ── */
.big-metric {
    font-size: clamp(1.1rem, 2.2vw, 2.4rem);
    font-weight: 700;
    color: #168bd2;
    line-height: 1.15;
    word-break: keep-all;
    overflow-wrap: normal;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.metric-label {
    font-size: 0.78rem;
    color: #ffffff;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
    background: linear-gradient(155deg, rgba(0, 0, 0, 0.98), rgba(0, 0, 0, 0.94));
    border: 1px solid #244d73;
    border-radius: 14px;
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.28);
}
.hero-panel-eyebrow {
    color: #168bd2;
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
    gap: 0.85rem;
    align-items: stretch;
    margin-top: 0.65rem;
}
.hero-metrics-grid-4x2 {
    grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
    grid-template-rows: repeat(2, auto) !important;
}
.hero-metrics-grid-5 {
    display: grid !important;
    grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
    width: 100% !important;
}
/* Home hero metrics iframe */
[data-testid="stMain"] [data-testid="stHtml"] iframe {
    border: none !important;
    background: #000000 !important;
}
.hero-dashboard-panel-inline {
    margin: 0.4rem 0 0.7rem 0;
    padding: 0.9rem 1rem 0.85rem;
}
.hero-status-card-compact {
    min-height: 108px;
    padding: 0.62rem 0.45rem 0.52rem;
}
.hero-status-card-compact .hero-status-value {
    font-weight: 900 !important;
}
@media (max-width: 900px) {
    .hero-metrics-grid-4x2 {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        grid-template-rows: auto !important;
    }
    .hero-metrics-grid-5 {
        grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
    }
}
@media (max-width: 520px) {
    .hero-metrics-grid-4x2 {
        grid-template-columns: 1fr !important;
    }
    .hero-metrics-grid-5 {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    }
    [data-testid="stMainBlockContainer"] {
        padding-left: 0.75rem !important;
        padding-right: 0.75rem !important;
    }
    .zgiis-title {
        font-size: 1.55rem;
    }
    .zgiis-tagline {
        font-size: 0.82rem;
        line-height: 1.35;
    }
    .hero-status-card,
    .hero-status-card-compact {
        min-height: 96px;
        padding: 0.55rem 0.4rem 0.45rem;
    }
    .hero-status-icon {
        font-size: 1.05rem;
        margin-bottom: 0.2rem;
    }
    .hero-status-value {
        font-size: 1.2rem;
    }
    .zgiis-card {
        padding: 0.8rem 0.9rem;
    }
}
.hero-metrics-grid .hero-status-card {
    margin-bottom: 0;
    background: rgba(0, 0, 0, 0.94);
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
    color: #ffffff;
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
.mobile-coverage-card {
    display: grid;
    gap: 0.75rem;
    padding: 1rem;
    background: #000000;
    border: 1px solid #244d73;
    border-radius: 10px;
}
.mobile-coverage-row {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr) 28px;
    align-items: center;
    gap: 0.65rem;
}
.mobile-coverage-label,
.mobile-coverage-value {
    color: #ffffff;
    font-size: 0.78rem;
    font-weight: 700;
}
.mobile-coverage-value {
    text-align: right;
}
.mobile-coverage-track {
    height: 10px;
    overflow: hidden;
    background: #163654;
    border-radius: 999px;
}
.mobile-coverage-fill {
    height: 100%;
    min-width: 4px;
    border-radius: inherit;
}

/* PRN Explorer — constellation name (GPS, Galileo, etc.) */
.prn-const-label {
    font-size: clamp(1.1rem, 1.6vw, 1.45rem) !important;
    font-weight: 800 !important;
    color: #ffffff !important;
    min-height: auto !important;
    letter-spacing: 0.02em;
    margin-bottom: 0.15rem;
}

/* ── CORS hardware (station requirements grid; diagram CSS lives in iframe) ── */
[data-testid="stMainBlockContainer"] [data-testid="stHtml"] iframe {
    width: 100% !important;
    max-width: 100% !important;
    border: none;
}
.cors-req-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.85rem;
}
@media (max-width: 900px) {
    .cors-req-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
@media (max-width: 520px) {
    .cors-req-grid {
        grid-template-columns: 1fr;
    }
}

/* ── VTEC Theory page callouts ── */
.vtec-why-box {
    background: #000000;
    border-left: 3px solid #f59e0b;
    border-radius: 6px;
    padding: 0.7rem 1rem;
    margin: 0.4rem 0 0.8rem;
    font-size: 0.82rem;
    line-height: 1.6;
}
.vtec-why-label {
    color: #f59e0b !important;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    font-size: 0.72rem;
}
.vtec-why-box,
.vtec-why-box p,
.vtec-why-box em,
.vtec-why-box span.vtec-why-text,
.vtec-why-box strong {
    color: #ffffff !important;
}

/* ── VTEC Theory IPP geometry diagram ── */
.ipp-geom-card {
    background: #000000;
    border: 1px solid #244d73;
    border-radius: 12px;
    padding: 0.65rem 0.5rem 0.45rem;
    max-width: 100%;
    overflow: hidden;
}
.ipp-geom-img {
    display: block;
    width: 100%;
    max-width: 520px;
    height: auto;
    margin: 0 auto;
}
.ipp-geom-card-iframe {
    padding: 0.35rem 0.25rem 0.2rem;
    overflow: hidden;
}
.ipp-geom-card-iframe iframe {
    border: none !important;
    background: #000000 !important;
}
.ipp-geom-svg {
    display: block;
    width: 100%;
    max-width: 380px;
    height: auto;
    margin: 0 auto;
}
.ipp-geom-legend {
    background: rgba(0, 0, 0, 0.94);
    border: 1px solid #244d73;
    border-left: 3px solid #168bd2;
    border-radius: 10px;
    padding: 0.85rem 0.9rem;
    font-size: 0.82rem;
    color: #ffffff;
    line-height: 1.45;
    max-width: 100%;
}
.ipp-geom-legend-title {
    color: #168bd2;
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 0.55rem;
}
.ipp-geom-legend table {
    width: 100%;
    border-collapse: collapse;
}
.ipp-geom-legend td {
    padding: 0.28rem 0;
    vertical-align: top;
}
.ipp-geom-legend td.sym {
    width: 5.5rem;
    font-style: italic;
    font-weight: 700;
    color: #ffffff;
    white-space: nowrap;
    vertical-align: middle;
}
.ipp-geom-legend td.sym .line,
.ipp-geom-legend td.sym .dot {
    display: inline-block;
    vertical-align: middle;
    margin-right: 0.4rem;
}
.ipp-geom-legend .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
}
.ipp-geom-legend .line {
    width: 1.1rem;
    height: 2px;
}
.ipp-geom-legend td.sym .sym-text {
    display: inline-block;
    vertical-align: middle;
}
@media (max-width: 720px) {
    .ipp-geom-svg {
        max-width: 100%;
    }
}

/* ── VTEC Theory step illustrations ── */
.vtec-illus-card {
    background: #000000;
    border: 1px solid #244d73;
    border-radius: 12px;
    padding: 0.75rem 0.7rem 0.6rem;
    max-width: 100%;
    overflow: hidden;
    min-height: 15.5rem;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
}
.vtec-illus-caption {
    color: #ffffff;
    font-size: 0.78rem;
    line-height: 1.45;
    margin-bottom: 0.5rem;
    padding: 0 0.15rem;
}
.vtec-illus-svg,
.vtec-illus-img {
    display: block;
    width: 100%;
    max-width: 100%;
    height: auto;
    margin: 0 auto;
    object-fit: contain;
}
.vtec-pipeline-svg,
.vtec-pipeline-img {
    max-width: 100%;
}
.vtec-pipeline-card {
    min-height: 9.5rem;
    padding: 0.75rem 0.5rem 0.55rem;
}
.vtec-step9-card {
    min-height: 22rem;
    padding: 0.85rem 0.75rem 0.7rem;
}
.vtec-step9-card .vtec-step9-img,
.vtec-step9-svg {
    max-width: 420px;
}
.vtec-overview-illus {
    margin: 0.5rem 0 1.2rem;
    display: flex;
    justify-content: center;
}
.vtec-overview-illus .vtec-illus-card {
    width: 100%;
    max-width: 100%;
    min-height: 10rem;
}

/* ── PRN Explorer — linked hero cards (no overlay / no extra row) ── */
.prn-const-card-link {
    display: block;
    color: inherit !important;
    text-decoration: none !important;
    min-width: 0;
}
.prn-const-card-link .hero-click-card {
    min-height: 158px;
    pointer-events: auto;
    cursor: pointer;
}
.prn-const-card-link:hover .hero-click-card {
    background: rgba(12, 28, 48, 0.98);
    box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.35);
}

/* ── Clickable hero cards (Space Weather) + invisible overlay ── */
.hero-click-slot { display: none; }
[data-testid="stHorizontalBlock"]:has([data-testid="column"] .hero-click-slot) {
    gap: 0.75rem;
    align-items: stretch;
}
.hero-click-card,
.prn-hero-card {
    margin-bottom: 0 !important;
    background: rgba(0, 0, 0, 0.94);
    border-radius: 10px;
    pointer-events: none;
    transition: box-shadow 0.15s, background 0.15s;
    width: 100%;
    box-sizing: border-box;
}
.hero-click-selected,
.prn-hero-selected {
    background: rgba(12, 28, 48, 0.98) !important;
    box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.4);
}
[data-testid="column"]:has(.hero-click-slot) [data-testid="stVerticalBlock"] {
    position: relative !important;
    min-height: 148px;
}
[data-testid="column"]:has(.hero-click-slot):hover .hero-click-card,
[data-testid="column"]:has(.hero-click-slot):hover .prn-hero-card {
    background: rgba(12, 28, 48, 0.98);
    box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.35);
}
[data-testid="column"]:has(.hero-click-slot) [data-testid="stVerticalBlock"] > div:nth-child(1) {
    margin-bottom: 0 !important;
}
[data-testid="column"]:has(.hero-click-slot) [data-testid="stVerticalBlock"] > div:nth-child(2) {
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    height: 148px !important;
    margin: 0 !important;
    z-index: 6 !important;
    padding: 0 !important;
}
[data-testid="column"]:has(.hero-click-slot) [data-testid="stVerticalBlock"] > div:nth-child(2) [data-testid="stButton"] {
    width: 100% !important;
    height: 148px !important;
}
[data-testid="column"]:has(.hero-click-slot) [data-testid="stVerticalBlock"] > div:nth-child(2) button,
[data-testid="column"]:has(.hero-click-slot) [data-testid="stVerticalBlock"] > div:nth-child(2) button[kind="secondary"] {
    width: 100% !important;
    height: 148px !important;
    min-height: 148px !important;
    max-height: 148px !important;
    opacity: 0 !important;
    cursor: pointer !important;
    border: none !important;
    background: transparent !important;
    padding: 0 !important;
    margin: 0 !important;
    box-shadow: none !important;
    font-size: 0 !important;
    color: transparent !important;
    white-space: nowrap !important;
    line-height: 0 !important;
}
[data-testid="column"]:has(.hero-click-slot) [data-testid="stVerticalBlock"] > div:nth-child(2) button * {
    opacity: 0 !important;
    font-size: 0 !important;
    color: transparent !important;
}
.dashboard-panel-marker {
    display: none;
}
[data-testid="stVerticalBlockBorderWrapper"]:has(.dashboard-panel-marker) {
    background: linear-gradient(155deg, rgba(0, 0, 0, 0.98), rgba(0, 0, 0, 0.94));
    border-color: #244d73 !important;
    border-radius: 14px !important;
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.28);
}
.dashboard-explanation-panel {
    margin-top: 0.9rem;
    margin-bottom: 0.2rem;
}
.dashboard-condition-banner {
    line-height: 1.5;
}
.dashboard-condition-banner strong {
    color: #ffffff;
    font-size: 0.95rem;
}
.dashboard-condition-banner span {
    color: inherit;
    font-size: 0.82rem;
}
.dashboard-clickable-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
    grid-template-rows: repeat(2, minmax(148px, auto)) !important;
    gap: 0.85rem;
    align-items: stretch;
}
.dashboard-card-link {
    display: block;
    color: inherit !important;
    text-decoration: none !important;
    min-width: 0;
}
.dashboard-card-link .hero-click-card {
    min-height: 148px;
    pointer-events: auto;
    cursor: pointer;
}
.dashboard-card-link:hover .hero-click-card {
    background: rgba(12, 28, 48, 0.98);
    box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.35);
}
@media (max-width: 700px) {
    .dashboard-clickable-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        grid-template-rows: auto !important;
    }
}
@media (max-width: 430px) {
    .dashboard-clickable-grid {
        grid-template-columns: 1fr !important;
    }
}

/* ── Horizontal Kp scale (Home dashboard) ── */
.hero-scales-grid {
    display: grid;
    grid-template-columns: 10.5rem minmax(0, 1fr);
    gap: 0.5rem 0.4rem;
    align-items: center;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(30, 58, 95, 0.65);
}
.hero-scale-band-row {
    display: grid;
    grid-template-columns: repeat(var(--scale-columns), minmax(0, 1fr));
    gap: 0.4rem;
    min-width: 0;
}
.hero-scales-grid-single {
    grid-template-columns: 10.5rem repeat(8, minmax(0, 1fr));
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
@media (max-width: 900px) {
    .hero-scales-grid {
        grid-template-columns: 8rem minmax(0, 1fr);
        overflow-x: auto;
    }
    .hero-scale-band-row {
        min-width: 43rem;
    }
}

/* ── Processing page prompt / start button spacing ── */
.proc-prompt-banner {
    background: #0d2a4a;
    border: 1px solid #1e5a8f;
    border-left: 4px solid #168bd2;
    border-radius: 8px;
    padding: 0.75rem 1rem;
    color: #ffffff;
    font-size: 0.92rem;
    margin-bottom: 0.35rem;
}
.proc-start-gap {
    height: 1.15rem;
}

/* Compact processing overview used on the VTEC theory page. */
.pipeline-overview-cards {
    display: grid;
    grid-template-columns: repeat(7, minmax(175px, 1fr));
    gap: 0.85rem;
    margin: 0.8rem 0 1.55rem;
    padding: 0.15rem 0 0.35rem;
}
.pipeline-overview-card {
    min-height: 62px;
    padding: 0.8rem 0.9rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: #ffffff;
    background: #000000;
    border: 1px solid #334a68;
    border-radius: 11px;
    font-size: 0.9rem;
    font-weight: 750;
    line-height: 1.25;
    text-align: center;
    white-space: normal;
    overflow-wrap: anywhere;
}
.pipeline-overview-icon {
    flex: 0 0 auto;
    font-size: 1.15rem;
}
@media (max-width: 1100px) {
    .pipeline-overview-cards {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.7rem;
    }
    .pipeline-overview-card {
        min-height: 68px;
        font-size: 0.92rem;
    }
}
@media (max-width: 560px) {
    .pipeline-overview-cards {
        grid-template-columns: 1fr;
        gap: 0.65rem;
        margin-bottom: 1.2rem;
    }
    .pipeline-overview-card {
        min-height: 64px;
        justify-content: flex-start;
        padding: 0.8rem 1rem;
        text-align: left;
        font-size: 0.95rem;
    }
    .pipeline-overview-icon {
        width: 1.5rem;
        font-size: 1.2rem;
        text-align: center;
    }
}

/* ── Processing pipeline stage buttons (scoped — not hero overlay buttons) ── */
[data-testid="stMarkdown"]:has(.pipeline-explorer-row) + [data-testid="stHorizontalBlock"] button[kind="secondary"] {
    height: 108px !important;
    min-height: 108px !important;
    max-height: 108px !important;
    white-space: pre-line !important;
    line-height: 1.35 !important;
    font-size: 0.78rem !important;
    color: #ffffff !important;
    background: #000000 !important;
    border: 1px solid #244d73 !important;
    border-radius: 10px !important;
    font-weight: 650 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
}
[data-testid="stMarkdown"]:has(.pipeline-explorer-row) + [data-testid="stHorizontalBlock"] button[kind="secondary"]:hover {
    border-color: #168bd2 !important;
    background: #102338 !important;
    color: #ffffff !important;
}
[data-testid="stMarkdown"]:has(.pipeline-explorer-row) + [data-testid="stHorizontalBlock"] button[kind="primary"] {
    background: #102338 !important;
    border-color: #168bd2 !important;
    box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.4) !important;
    color: #ffffff !important;
}

/* ── Processing pipeline explanation panel ── */
.pipeline-explain-panel {
    margin-top: 0.9rem;
    padding: 1rem 1.15rem;
    background: #000000;
    border: 1px solid #244d73;
    border-left: 3px solid #168bd2;
    border-radius: 10px;
}
.pipeline-explain-title {
    color: #ffffff;
    font-size: 1rem;
    font-weight: 800;
    margin-bottom: 0.25rem;
}
.pipeline-explain-section {
    color: #ffffff;
    font-size: 0.78rem;
    font-weight: 700;
    margin-bottom: 0.55rem;
}
.pipeline-explain-heading {
    color: #ffffff;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0.65rem 0 0.25rem;
}
.pipeline-explain-body {
    color: #ffffff;
    font-size: 0.86rem;
    line-height: 1.55;
    margin: 0;
}
.pipeline-explain-cite {
    color: #ffffff;
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
    color: #168bd2 !important;
    font-size: 0.76rem !important;
    font-weight: 700 !important;
}
div[data-testid="stMarkdownContainer"] div.katex-display {
    margin: 0.45rem 0 0.75rem !important;
    padding: 0.55rem 0.75rem !important;
    background: rgba(0, 0, 0, 0.28) !important;
    border-left: 2px solid #168bd2 !important;
    border-radius: 6px !important;
    overflow-x: auto !important;
}
div[data-testid="stMarkdownContainer"] .katex {
    color: #ffffff !important;
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
    color: #ffffff;
    font-size: 0.86rem;
    background: #000000;
    border: 1px solid #1e4e78;
    border-left: 4px solid #168bd2;
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
    color: #ffffff;
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
[data-testid="stMetricValue"] { color: #168bd2 !important; font-weight: 700; }
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
    border: 1px solid #168bd2 !important;
    color: #ffffff !important;
    -webkit-text-fill-color: #ffffff !important;
}
button[kind="primary"] p,
button[kind="primary"] span,
button[kind="primary"] div,
button[kind="primary"] * {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
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
    color: #ffffff !important;
    font-weight: 600 !important;
}

/* Typed text inside text inputs and number inputs */
[data-testid="stSidebar"] input[type="text"],
[data-testid="stSidebar"] input[type="number"],
[data-testid="stSidebar"] textarea {
    color: #ffffff !important;
    background-color: #0a1e33 !important;
    border: 1px solid #2a5080 !important;
    caret-color: #168bd2 !important;
}

/* Placeholder text in inputs */
[data-testid="stSidebar"] input::placeholder,
[data-testid="stSidebar"] textarea::placeholder {
    color: #ffffff !important;
}

/* Select all / Clear all buttons — reset pipeline overrides, keep compact */
[data-testid="stSidebar"] button[kind="secondary"],
[data-testid="stSidebar"] button:not([kind="primary"]) {
    min-height: unset !important;
    height: auto !important;
    white-space: nowrap !important;
    background-color: #0a2040 !important;
    border: 1px solid #2a5080 !important;
    color: #ffffff !important;
    font-weight: 600 !important;
    font-size: 0.78rem !important;
    padding: 0.3rem 0.6rem !important;
    line-height: 1.3 !important;
}
[data-testid="stSidebar"] button[kind="secondary"]:hover,
[data-testid="stSidebar"] button:not([kind="primary"]):hover {
    background-color: #0d3060 !important;
    border-color: #168bd2 !important;
    color: #168bd2 !important;
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
    color: #ffffff !important;
}
/* Selected tags (pills) inside multiselect */
[data-testid="stSidebar"] [data-baseweb="tag"] {
    background-color: #003355 !important;
    border: 1px solid #168bd2 !important;
}
[data-testid="stSidebar"] [data-baseweb="tag"] span {
    color: #ffffff !important;
    font-weight: 600 !important;
}
/* Tag × close button */
[data-testid="stSidebar"] [data-baseweb="tag"] [role="button"] svg {
    fill: #7bbcdd !important;
}

/* Number input +/- buttons */
[data-testid="stSidebar"] [data-testid="stNumberInputStepDown"],
[data-testid="stSidebar"] [data-testid="stNumberInputStepUp"] {
    color: #168bd2 !important;
    background-color: #0a2040 !important;
}

/* Checkbox and radio text */
[data-testid="stSidebar"] .stCheckbox span,
[data-testid="stSidebar"] .stRadio span {
    color: #ffffff !important;
}

/* Caption / small helper text */
[data-testid="stSidebar"] small,
[data-testid="stSidebar"] .stCaption,
[data-testid="stSidebar"] [data-testid="stCaptionContainer"] {
    color: #ffffff !important;
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
    background: #000000;
    border-top: 1px solid #244d73;
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
/* ── Dataframe / table white text ── */
[data-testid="stDataFrame"] * { color: #ffffff !important; }
[data-testid="stDataFrame"] canvas { color: #ffffff !important; }

/* ── Site-wide: eliminate grey/muted body text ── */
[data-testid="stMain"] {
    color: #ffffff !important;
}
[data-testid="stMain"] [data-testid="stMarkdownContainer"],
[data-testid="stMain"] [data-testid="stMarkdownContainer"] p,
[data-testid="stMain"] [data-testid="stMarkdownContainer"] li,
[data-testid="stMain"] [data-testid="stMarkdownContainer"] span,
[data-testid="stMain"] [data-testid="stMarkdownContainer"] em,
[data-testid="stMain"] [data-testid="stMarkdownContainer"] td,
[data-testid="stMain"] [data-testid="stMarkdownContainer"] th,
[data-testid="stSidebar"] label,
[data-testid="stSidebar"] span,
[data-testid="stSidebar"] p,
[data-testid="stSidebar"] small,
[data-testid="stSidebar"] .stCaption,
[data-testid="stSidebar"] [data-testid="stCaptionContainer"],
[data-testid="stExpander"] label p,
[data-testid="stExpander"] [data-testid="stMarkdownContainer"] p {
    color: #ffffff !important;
    -webkit-text-fill-color: #ffffff !important;
}
[data-testid="stSidebar"] input::placeholder,
[data-testid="stSidebar"] textarea::placeholder {
    color: #ffffff !important;
    opacity: 0.72;
}

/* ── Plotly chart text ── */
.js-plotly-plot .plotly .main-svg text,
.js-plotly-plot .plotly .main-svg tspan {
    opacity: 1;
}

/* Mobile layout shared by every Streamlit page. */
@media (max-width: 700px) {
    [data-testid="stMainBlockContainer"] {
        max-width: 100% !important;
        padding: 1rem 0.75rem 4rem !important;
    }
    [data-testid="stHorizontalBlock"] {
        flex-wrap: wrap !important;
        gap: 0.75rem !important;
    }
    [data-testid="stHorizontalBlock"] > [data-testid="stColumn"] {
        flex: 1 1 100% !important;
        width: 100% !important;
        min-width: 0 !important;
    }
    [data-testid="stVerticalBlock"] {
        gap: 0.75rem !important;
    }
    [data-testid="stSidebar"] {
        max-width: min(88vw, 21rem) !important;
    }
    [data-testid="stSidebar"] button,
    [data-testid="stMain"] button,
    [data-testid="stMain"] a {
        min-height: 44px;
    }
    [data-baseweb="tab-list"] {
        overflow-x: auto !important;
        overflow-y: hidden !important;
        flex-wrap: nowrap !important;
        scrollbar-width: thin;
    }
    [data-baseweb="tab"] {
        flex: 0 0 auto !important;
        min-height: 44px;
        padding-left: 0.8rem !important;
        padding-right: 0.8rem !important;
    }
    [role="radiogroup"],
    [data-testid="stSegmentedControl"] > div {
        flex-wrap: wrap !important;
    }
    [data-testid="stDataFrame"],
    [data-testid="stTable"],
    [data-testid="stPlotlyChart"],
    [data-testid="stImage"],
    iframe {
        max-width: 100% !important;
    }
    [data-testid="stDataFrame"],
    [data-testid="stTable"] {
        overflow-x: auto !important;
    }
    [data-testid="stPlotlyChart"] .js-plotly-plot,
    [data-testid="stPlotlyChart"] .plot-container,
    [data-testid="stPlotlyChart"] .svg-container {
        width: 100% !important;
        max-width: 100% !important;
    }
    img,
    svg {
        max-width: 100%;
        height: auto;
    }
    h1 {
        font-size: clamp(1.55rem, 7vw, 2rem) !important;
        line-height: 1.2 !important;
    }
    h2 {
        font-size: clamp(1.3rem, 6vw, 1.65rem) !important;
    }
    h3 {
        font-size: clamp(1.1rem, 5vw, 1.4rem) !important;
    }
    .zgiis-footer {
        padding-left: 0.75rem;
        padding-right: 0.75rem;
        text-align: center;
        line-height: 1.45;
    }
}

@media (max-width: 430px) {
    [data-testid="stMainBlockContainer"] {
        padding-left: 0.55rem !important;
        padding-right: 0.55rem !important;
    }
    .hero-metrics-grid-5 {
        grid-template-columns: 1fr !important;
    }
    .mobile-coverage-row {
        grid-template-columns: 64px minmax(0, 1fr) 24px;
        gap: 0.45rem;
    }
}
</style>
"""

_FOOTER_HTML = """
<div class="zgiis-footer">
    &copy; 2026 <span>Zimbabwe National Geospatial and Space Agency (ZINGSA)</span>
    &nbsp;&mdash;&nbsp; All rights reserved
</div>
"""


def inject(
    st_instance,
    *,
    page_id: str | None = None,
    clear_keys_on_enter: tuple[str, ...] = (),
) -> None:
    """Call this once per page after set_page_config."""
    if page_id:
        prev = st_instance.session_state.get("zgiis_page_script")
        if prev != page_id:
            for key in clear_keys_on_enter:
                st_instance.session_state.pop(key, None)
        st_instance.session_state["zgiis_page_script"] = page_id
    st_instance.markdown(DARK_CSS, unsafe_allow_html=True)
    st_instance.markdown(_FOOTER_HTML, unsafe_allow_html=True)
