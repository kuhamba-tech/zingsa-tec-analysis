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

    @property
    def status_color(self) -> str:
        return {"online": "#00ff88", "degraded": "#ff8c00", "offline": "#ff4444"}.get(self.status, "#888")

    @property
    def status_icon(self) -> str:
        return {"online": "🟢", "degraded": "🟡", "offline": "🔴"}.get(self.status, "⚪")


ZIMBABWE_CORS_STATIONS: List[CorsStation] = [
    CorsStation("hara", "Harare",       -17.8252,  31.0335, "online",    ["GPS", "GLONASS", "Galileo"], current_tec=22.4),
    CorsStation("bula", "Bulawayo",     -20.1600,  28.5800, "online",    ["GPS", "GLONASS"],            current_tec=20.1),
    CorsStation("gwer", "Gweru",        -19.4500,  29.8200, "online",    ["GPS"],                       current_tec=21.3),
    CorsStation("kwek", "Kwekwe",       -18.9250,  29.8200, "online",    ["GPS", "Galileo"],            current_tec=21.8),
    CorsStation("muta", "Mutare",       -18.9700,  32.6500, "online",    ["GPS", "GLONASS"],            current_tec=23.1),
    CorsStation("chim", "Chimanimani",  -19.7900,  32.8600, "degraded",  ["GPS"],                       current_tec=0.0),
    CorsStation("chir", "Chiredzi",     -21.0400,  31.6700, "online",    ["GPS"],                       current_tec=19.6),
    CorsStation("gokw", "Gokwe",        -18.2200,  28.9300, "online",    ["GPS", "GLONASS"],            current_tec=21.0),
    CorsStation("karo", "Karoi",        -16.8000,  29.6800, "online",    ["GPS"],                       current_tec=23.8),
    CorsStation("cent", "Centenary",    -16.7300,  31.1200, "online",    ["GPS", "Galileo"],            current_tec=24.2),
    CorsStation("lupa", "Lupane",       -18.9300,  27.8100, "offline",   ["GPS"],                       current_tec=0.0),
    CorsStation("gsu",  "Gwanda",       -20.9400,  29.0000, "online",    ["GPS"],                       current_tec=19.2),
    CorsStation("zinh", "ZINH",         -17.7500,  31.0000, "online",    ["GPS", "GLONASS", "Galileo", "BeiDou"], current_tec=22.7),
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
