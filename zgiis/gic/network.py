"""ZETDC transmission network model for GIC monitoring.

Static infrastructure metadata (substations and HV transmission lines)
digitised from the ZETDC substation map used in the ZINGSA/ZETDC GIC
research programme. Coordinates are approximate site locations intended
for the network map visualisation, not survey-grade positions.
"""
from __future__ import annotations

# ── ZETDC HV substations (from the ZETDC substation map) ────────────────────
SUBSTATIONS: list[dict] = [
    {"code": "KARIBA", "name": "Kariba", "lat": -16.5219, "lon": 28.7619},
    {"code": "ALASKA", "name": "Alaska (Chinhoyi)", "lat": -17.3300, "lon": 30.1200},
    {"code": "MUTORASHANGA", "name": "Mutorashanga", "lat": -17.1560, "lon": 30.6680},
    {"code": "WARREN", "name": "Warren (Harare)", "lat": -17.8310, "lon": 30.9740},
    {"code": "HARARE", "name": "Harare", "lat": -17.8090, "lon": 31.0850},
    {"code": "DEMA", "name": "Dema (Seke)", "lat": -18.0630, "lon": 31.1990},
    {"code": "ORANGE_GROVE", "name": "Orange Grove (Mutare)", "lat": -18.9310, "lon": 32.6250},
    {"code": "SHERWOOD", "name": "Sherwood (Kwekwe)", "lat": -18.9370, "lon": 29.8180},
    {"code": "HAVEN", "name": "Haven", "lat": -19.1000, "lon": 29.6500},
    {"code": "CHERTSEY", "name": "Chertsey (Gweru)", "lat": -19.4900, "lon": 29.6600},
    {"code": "INSUKAMINI", "name": "Insukamini (Bulawayo)", "lat": -20.0330, "lon": 28.6670},
    {"code": "HWANGE", "name": "Hwange", "lat": -18.3800, "lon": 26.4700},
    {"code": "RUSHINGA", "name": "Rushinga (border)", "lat": -16.6500, "lon": 32.2500},
    {"code": "SW_BORDER", "name": "Southern interconnector (border)", "lat": -21.8500, "lon": 28.2000},
]

# ── ZPC power generation stations (ZESA Holdings / Zimbabwe Power Company) ───
# Source: https://www.zesaholdings.co.zw/ZPC — Kariba South hydro plus Hwange
# and the Bulawayo, Harare, and Munyati thermal stations. Coordinates are
# approximate plant locations for map context, not survey-grade positions.
POWER_PLANTS: list[dict] = [
    {
        "code": "KARIBA_SOUTH",
        "name": "Kariba South (ZPC)",
        "lat": -16.5253,
        "lon": 28.7686,
        "fuel": "hydro",
        "operator": "ZPC",
        "status": "operational",
        "capacity_mw": 1050,
        "linked_substation": "KARIBA",
        "notes": "Kariba South Hydropower Station — ZPC flagship hydro plant on Lake Kariba.",
    },
    {
        "code": "HWANGE_PS",
        "name": "Hwange (ZPC)",
        "lat": -18.3647,
        "lon": 26.4831,
        "fuel": "coal",
        "operator": "ZPC",
        "status": "operational",
        "capacity_mw": 920,
        "linked_substation": "HWANGE",
        "notes": "Hwange Power Station — largest coal-fired plant in Zimbabwe.",
    },
    {
        "code": "MUNYATI",
        "name": "Munyati (ZPC)",
        "lat": -19.4169,
        "lon": 29.7336,
        "fuel": "coal",
        "operator": "ZPC",
        "status": "care_and_maintenance",
        "capacity_mw": 100,
        "linked_substation": "SHERWOOD",
        "notes": "Munyati thermal station — under care and maintenance; ZPC repurposing study in progress.",
    },
    {
        "code": "BULAWAYO_PS",
        "name": "Bulawayo (ZPC)",
        "lat": -20.1547,
        "lon": 28.5833,
        "fuel": "coal",
        "operator": "ZPC",
        "status": "care_and_maintenance",
        "capacity_mw": 90,
        "linked_substation": "INSUKAMINI",
        "notes": "Bulawayo thermal station — under care and maintenance; ZPC repurposing study in progress.",
    },
    {
        "code": "HARARE_PS",
        "name": "Harare (ZPC)",
        "lat": -17.8178,
        "lon": 31.0333,
        "fuel": "coal",
        "operator": "ZPC",
        "status": "care_and_maintenance",
        "capacity_mw": 90,
        "linked_substation": "HARARE",
        "notes": "Harare thermal station — under care and maintenance; ZPC repurposing study in progress.",
    },
]

# Dashed generation tie-lines from ZPC plants to the nearest ZETDC substation.
GENERATION_LINKS: list[dict] = [
    {"from": "KARIBA_SOUTH", "to": "KARIBA"},
    {"from": "HWANGE_PS", "to": "HWANGE"},
    {"from": "MUNYATI", "to": "SHERWOOD"},
    {"from": "BULAWAYO_PS", "to": "INSUKAMINI"},
    {"from": "HARARE_PS", "to": "HARARE"},
]

# ── Transmission lines (voltage in kV) ───────────────────────────────────────
LINES: list[dict] = [
    {"from": "KARIBA", "to": "ALASKA", "kv": 330},
    {"from": "ALASKA", "to": "WARREN", "kv": 330},
    {"from": "MUTORASHANGA", "to": "WARREN", "kv": 330},
    {"from": "WARREN", "to": "HARARE", "kv": 330},
    {"from": "HARARE", "to": "DEMA", "kv": 330},
    {"from": "HARARE", "to": "RUSHINGA", "kv": 330},
    {"from": "DEMA", "to": "ORANGE_GROVE", "kv": 330},
    {"from": "WARREN", "to": "SHERWOOD", "kv": 330},
    {"from": "SHERWOOD", "to": "HAVEN", "kv": 330},
    {"from": "HAVEN", "to": "CHERTSEY", "kv": 330},
    {"from": "CHERTSEY", "to": "INSUKAMINI", "kv": 330},
    {"from": "HWANGE", "to": "SHERWOOD", "kv": 330},
    {"from": "HWANGE", "to": "INSUKAMINI", "kv": 330},
    {"from": "INSUKAMINI", "to": "SW_BORDER", "kv": 400},
]

# ── GIC monitoring stations (field deployments per the ZINGSA/ZETDC setup) ──
# Field architecture: GMW CPCO clamp sensor on transformer neutral →
# Campbell Scientific CR1000 datalogger → RS232/USB → Raspberry Pi 4
# gateway → 4G/LTE → this server (JSON ingest), with CSV/TOA5 file upload
# as the offline path.
MONITORING_STATIONS: list[dict] = [
    {
        "station_id": "DEMA_001",
        "name": "Dema (Seke)",
        "substation": "DEMA",
        "sensor": "GMW CPCO clamp sensor on transformer neutral/ground lead",
        "datalogger": "Campbell Scientific CR1000",
        "gateway": "Raspberry Pi 4 + 4G/LTE router (JSON/MQTT)",
        "notes": "GIC monitoring station at Dema substation (ZINGSA/ZETDC programme).",
    },
    {
        "station_id": "ALASKA_001",
        "name": "Alaska (Chinhoyi)",
        "substation": "ALASKA",
        "sensor": "GMW CPCO clamp sensor on transformer neutral/ground lead",
        "datalogger": "Campbell Scientific CR1000",
        "gateway": "Raspberry Pi 4 + 4G/LTE router (JSON/MQTT)",
        "notes": "GIC monitoring station at Alaska substation (ZINGSA/ZETDC programme).",
    },
]

# ── GIC magnitude interpretation bands (from the literature) ─────────────────
# <5 A quiet; ≥10 A "large" per the EPRI SUNBURST occurrence study
# (Space Weather, 2023); 25–35 A onset of even-order harmonic generation via
# asymmetric half-cycle transformer core saturation and >30 A increased
# reactive power draw (~0.026–0.038 MVAr/A) per the Gannon-storm transformer
# response study (Space Weather, 2024).
RISK_BANDS: list[dict] = [
    {"level": "Quiet", "min_abs_a": 0.0, "color": "#00ff88",
     "meaning": "Background level — no transformer impact expected."},
    {"level": "Elevated", "min_abs_a": 5.0, "color": "#a3e635",
     "meaning": "Above background — watch space-weather indices."},
    {"level": "Large", "min_abs_a": 10.0, "color": "#ff8c00",
     "meaning": "Large GIC event (EPRI SUNBURST criterion). Log and cross-check Kp/Dst."},
    {"level": "High", "min_abs_a": 25.0, "color": "#ff4444",
     "meaning": "Even-order harmonic generation likely — asymmetric half-cycle core saturation onset."},
    {"level": "Severe", "min_abs_a": 35.0, "color": "#d946ef",
     "meaning": "Transformer core saturation with increased reactive power draw (~0.03 MVAr/A). Risk of heating/tripping."},
]


def classify_gic(abs_amps: float | None) -> dict | None:
    """Return the risk band a |GIC| magnitude falls in."""
    if abs_amps is None:
        return None
    band = RISK_BANDS[0]
    for b in RISK_BANDS:
        if abs_amps >= b["min_abs_a"]:
            band = b
    return band
