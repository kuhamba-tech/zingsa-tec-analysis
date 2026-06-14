"""Zimbabwe CORS network station registry."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import List

@dataclass
class CorsStation:
    code: str
    name: str
    lat: float
    lon: float
    status: str  # "online" | "offline" | "degraded"
    constellations: List[str] = field(default_factory=list)
    last_file: str = ""
    current_tec: float = 0.0
    elevation_mask: float = 15.0
    height_m: float = 0.0
    observation_count: int = 0
    data_start: str = ""
    data_end: str = ""

    @property
    def status_color(self) -> str:
        return {
            "online": "#1D9E75",
            "degraded": "#EF9F27",
            "offline": "#ef4444",
        }.get(normalize_station_status(self.status), "#94a3b8")

    @property
    def status_icon(self) -> str:
        return {
            "online": "🟢",
            "degraded": "🟡",
            "offline": "🔴",
        }.get(normalize_station_status(self.status), "⚪")


def normalize_station_status(status: str) -> str:
    """Map legacy/API labels to the three map legend statuses."""
    s = (status or "").lower()
    if s in ("online", "offline", "degraded"):
        return s
    if s == "unknown":
        return s
    if s in ("warning", "critical"):
        return "degraded" if s == "warning" else "offline"
    # Legacy pipeline / catalog labels (registered, loaded, etc.)
    return "offline"


def api_status_to_map(status: str) -> str:
    """Map CORS health API status strings to map legend statuses."""
    s = (status or "").upper()
    if s == "ONLINE":
        return "online"
    if s == "DEGRADED":
        return "degraded"
    return "offline"


def stations_for_map(health: dict | None = None) -> List[CorsStation]:
    """Return CORS stations with live health statuses when the API is available."""
    from dataclasses import replace

    if health is None:
        try:
            from zgiis.api.cors_client import fetch_station_health

            health = fetch_station_health(country="Zimbabwe")
        except Exception:
            health = None

    summary = (health or {}).get("health_summary") or {}
    rows = (health or {}).get("stations") or []
    if not rows or int(summary.get("telemetry_live") or 0) <= 0:
        return [
            replace(s, status="unknown", current_tec=0.0)
            for s in ZIMBABWE_CORS_STATIONS
        ]

    by_code: dict[str, str] = {}
    for row in rows:
        code = str(row.get("station_id", "")).lower().rstrip("_")
        if code:
            by_code[code] = api_status_to_map(row.get("status"))

    merged: List[CorsStation] = []
    for station in ZIMBABWE_CORS_STATIONS:
        code = station.code.lower().rstrip("_")
        live = by_code.get(code)
        status = live if live else normalize_station_status(station.status)
        merged.append(replace(station, status=status))
    return merged

ZIMBABWE_CORS_STATIONS: List[CorsStation] = [
    # Coordinates imported from CORS_FILES/corszingsa.xlsx on 2026-06-13.
    CorsStation("muto", "Mutoko",       -17.40452552, 32.21956895, "online",     ["GPS"], height_m=1265.3981),
    CorsStation("mata", "Mataga",       -20.84527778, 30.19333333, "degraded",   ["GPS"], height_m=1000.0000),
    CorsStation("muta", "Mutare",       -18.97829762, 32.67722325, "online",     ["GPS", "GLONASS"], height_m=1113.0200),
    CorsStation("bula", "Bulawayo",     -20.16531328, 28.64114319, "online",     ["GPS", "GLONASS"], height_m=1392.4000),
    CorsStation("gwer", "Gweru",        -19.51195226, 29.84053989, "online",     ["GPS", "GLONASS"], height_m=1438.8300),
    CorsStation("hacy", "Harare City",  -17.82516600, 31.03351100, "degraded",   ["GPS", "GLONASS"]),
    CorsStation("masv", "Masvingo",     -20.08775776, 30.83149252, "online",     ["GPS", "GLONASS"], height_m=1096.5400),
    CorsStation("hara", "Harare",       -17.78140871, 31.04856188, "online",     ["GPS", "GLONASS"], height_m=1525.7100),
    CorsStation("zinh", "ZINGSA HQ",    -17.78483089, 31.05063364, "online",     ["GPS", "GLONASS", "Galileo", "BeiDou"], height_m=1514.9404),
    CorsStation("lupa", "Lupane",       -18.94696921, 27.76074133, "online",     ["GPS", "GLONASS", "Galileo", "BeiDou"], height_m=986.2676),
    CorsStation("cent", "Centenary",    -16.73144103, 31.11882966, "online",     ["GPS", "GLONASS", "Galileo", "BeiDou"], height_m=1222.0549),
    CorsStation("karo", "Karoi",        -16.81896637, 29.68364577, "online",     ["GPS", "GLONASS", "Galileo", "BeiDou"], height_m=1286.5621),
    CorsStation("kwek", "Kwekwe",       -18.93450249, 29.80392498, "online",     ["GPS", "GLONASS", "Galileo", "BeiDou"], height_m=1231.4777),
    CorsStation("gokw", "Gokwe",        -18.21248449, 28.93207200, "online",     ["GPS", "GLONASS", "Galileo", "BeiDou"], height_m=1292.7306),
    CorsStation("gsu",  "GSU",          -20.43602472, 29.27481487, "online",     ["GPS", "GLONASS", "Galileo", "BeiDou"], height_m=1212.7989),
    CorsStation("chir", "Chiredzi",     -21.04512914, 31.66864490, "online",     ["GPS", "GLONASS", "Galileo", "BeiDou"], height_m=434.6533),
    CorsStation("chim", "Chimanimani",  -19.80266433, 32.87045111, "online",     ["GPS", "GLONASS", "Galileo", "BeiDou"], height_m=1539.1271),
    CorsStation("chiv", "Chivhu",       -19.01795928, 30.89528957, "online",     ["GPS", "GLONASS", "Galileo", "BeiDou"], height_m=1466.4191),
    CorsStation("kari", "Kariba",       -16.51946232, 28.79036193, "online",     ["GPS", "GLONASS", "Galileo", "BeiDou"], height_m=753.4219),
    CorsStation("tsho", "Tsholotsho",   -19.77047206, 27.76089160, "online",     ["GPS", "GLONASS", "Galileo", "BeiDou"], height_m=1107.5636),
    CorsStation("vicf", "Victoria Falls", -17.92673716, 25.84053994, "online",     ["GPS", "GLONASS", "Galileo", "BeiDou"], height_m=922.5889),
    CorsStation("gutu", "Gutu",         -19.64609500, 31.14708901, "online",     ["GPS", "GLONASS", "Galileo", "BeiDou"], height_m=1396.6381),
    CorsStation("beit", "Beitbridge",   -22.21018295, 29.99524904, "online",     ["GPS", "GLONASS", "Galileo", "BeiDou"], height_m=486.8955),
    CorsStation("bing", "Binga",        -17.62509280, 27.33817181, "online",     ["GPS", "GLONASS", "Galileo", "BeiDou"], height_m=632.9443),
]


def get_station(code: str) -> CorsStation | None:
    code = code.lower()
    return next((s for s in ZIMBABWE_CORS_STATIONS if s.code == code), None)


def get_online_stations() -> List[CorsStation]:
    return [s for s in ZIMBABWE_CORS_STATIONS if s.status == "online"]


def update_tec_from_df(df) -> None:
    """Update current_tec for stations from a processed DataFrame."""
    if df is None or df.empty or "station" not in df.columns or "vtec" not in df.columns:
        return
    latest = df.groupby("station")["vtec"].mean()
    for station in ZIMBABWE_CORS_STATIONS:
        if station.code in latest.index:
            station.current_tec = round(float(latest[station.code]), 2)
