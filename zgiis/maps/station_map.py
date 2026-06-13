"""Leaflet/Folium station map for Zimbabwe CORS network."""
from __future__ import annotations

from datetime import datetime
import math
from typing import Iterable, Literal, TYPE_CHECKING
from zoneinfo import ZoneInfo

from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS, CorsStation

if TYPE_CHECKING:
    import folium

STATUS_COLORS = {
    "online": "#1D9E75",
    "degraded": "#EF9F27",
    "offline": "#ef4444",
    "registered": "#38bdf8",
    "loaded": "#00d4ff",
    "processed": "#00ff88",
}

TILE_LAYERS: dict[str, dict] = {
    "hybrid": {
        "label": "Hybrid",
        "tiles": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "attr": "Esri World Imagery",
        "overlay_tiles": (
            "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/"
            "World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
        ),
        "overlay_attr": "Esri Reference",
        "max_zoom": 19,
    },
    "satellite": {
        "label": "Satellite",
        "tiles": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "attr": "Esri",
        "max_zoom": 19,
    },
    "street": {
        "label": "Street",
        "tiles": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        "attr": "Tiles Esri / OpenStreetMap",
        "max_zoom": 19,
    },
    "tec_heatmap": {
        "label": "TEC Heat Map",
        "tiles": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "attr": "Esri World Imagery",
        "overlay_tiles": (
            "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/"
            "World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
        ),
        "overlay_attr": "Esri Reference",
        "max_zoom": 19,
    },
}

MAP_STYLE_OPTIONS = ["Hybrid", "Satellite", "Street", "TEC Heat Map"]
MAP_STYLE_KEYS = ["hybrid", "satellite", "street", "tec_heatmap"]


def _status_color(status: str) -> str:
    return STATUS_COLORS.get(status, "#94a3b8")


def _tec_color(tec: float) -> str:
    """Map VTEC (TECU) to a colour ramp (10–40 TECU)."""
    if tec <= 0:
        return "#000080"
    stops = [
        (10, (0, 0, 128)),
        (18, (0, 128, 255)),
        (25, (0, 255, 128)),
        (32, (255, 128, 0)),
        (40, (255, 0, 0)),
    ]
    value = max(10.0, min(40.0, tec))
    for i in range(len(stops) - 1):
        lo_t, lo_rgb = stops[i]
        hi_t, hi_rgb = stops[i + 1]
        if value <= hi_t:
            ratio = (value - lo_t) / (hi_t - lo_t) if hi_t > lo_t else 0.0
            r = int(lo_rgb[0] + (hi_rgb[0] - lo_rgb[0]) * ratio)
            g = int(lo_rgb[1] + (hi_rgb[1] - lo_rgb[1]) * ratio)
            b = int(lo_rgb[2] + (hi_rgb[2] - lo_rgb[2]) * ratio)
            return f"#{r:02x}{g:02x}{b:02x}"
    return "#ff0000"


def _map_tec_values(stations: list[CorsStation]) -> dict[str, tuple[float, bool]]:
    """Return station TEC values and whether each value is spatially estimated."""
    measured = [station for station in stations if station.current_tec > 0]
    values: dict[str, tuple[float, bool]] = {}

    for station in stations:
        if station.current_tec > 0:
            values[station.code] = (station.current_tec, False)
            continue
        if not measured:
            values[station.code] = (0.0, False)
            continue

        weighted_total = 0.0
        weight_sum = 0.0
        for source in measured:
            mean_latitude = math.radians((station.lat + source.lat) / 2)
            lat_scale = max(0.2, math.cos(mean_latitude))
            lat_delta = station.lat - source.lat
            lon_delta = (station.lon - source.lon) * lat_scale
            distance_sq = lat_delta * lat_delta + lon_delta * lon_delta
            weight = 1.0 / max(distance_sq, 0.01)
            weighted_total += source.current_tec * weight
            weight_sum += weight

        values[station.code] = (round(weighted_total / weight_sum, 1), True)

    return values


def _station_popup_html(
    station: CorsStation,
    tec_value: float,
    is_estimated: bool,
    updated_at: str,
) -> str:
    tec_label = "Estimated VTEC" if is_estimated else "VTEC"
    tec_str = f"{tec_value:.1f} TECU" if tec_value > 0 else "No TEC data"
    tec_note = (
        "<br><span style='font-size:11px;color:#64748b'>"
        "Spatial estimate from nearby stations</span>"
        if is_estimated
        else ""
    )
    const_str = " · ".join(station.constellations) or "—"
    status = station.status.upper()
    status_color = _status_color(station.status)
    height_str = f"{station.height_m:,.1f} m" if station.height_m else "—"
    data_details = ""
    if station.last_file:
        data_details += f"<br>Source: {station.last_file}"
    if station.observation_count:
        data_details += f"<br>Observations: {station.observation_count:,}"
    if station.data_start or station.data_end:
        period_start = station.data_start or "—"
        period_end = station.data_end or "—"
        data_details += f"<br>Data period: {period_start} to {period_end}"
    return (
        f"<div style='min-width:190px;font-family:sans-serif'>"
        f"<b>{station.code.upper()} — {station.name}</b><br>"
        f"Status: <span style='color:{status_color};font-weight:700'>{status}</span><br>"
        f"{tec_label}: <span style='color:#0284c7;font-size:17px;font-weight:800'>{tec_str}</span>"
        f"{tec_note}<br>"
        f"Lat: {abs(station.lat):.5f}° {'S' if station.lat < 0 else 'N'}<br>"
        f"Lon: {abs(station.lon):.5f}° {'W' if station.lon < 0 else 'E'}<br>"
        f"Height: {height_str}<br>"
        f"Constellations: {const_str}"
        f"{data_details}<br>"
        f"<div style='margin-top:7px;padding-top:6px;border-top:1px solid #dbe3ec;"
        f"font-size:11px;color:#64748b'>Last updated: {updated_at}</div>"
        f"</div>"
    )


def build_cors_folium_map(
    stations: Iterable[CorsStation] | None = None,
    *,
    color_by: Literal["status", "tec"] = "status",
    map_style: str = "hybrid",
    show_tec_legend: bool = False,
) -> "folium.Map":
    """Return a Folium map centred on Zimbabwe with CORS station markers."""
    try:
        import folium
        from branca.element import MacroElement, Template
        from folium import CircleMarker, Popup
        from folium.plugins import HeatMap
    except ImportError as exc:
        raise ImportError(
            "folium is required for the CORS map. Run: pip install folium streamlit-folium"
        ) from exc

    station_list = list(stations if stations is not None else ZIMBABWE_CORS_STATIONS)
    map_tec_values = _map_tec_values(station_list)
    updated_at = datetime.now(ZoneInfo("Africa/Harare")).strftime(
        "%d %b %Y, %H:%M CAT"
    )
    layer = TILE_LAYERS.get(map_style, TILE_LAYERS["hybrid"])

    m = folium.Map(
        location=[-18.85, 29.75],
        zoom_start=6,
        tiles=layer["tiles"],
        attr=layer["attr"],
        subdomains=layer.get("subdomains", ""),
        max_zoom=layer.get("max_zoom", 19),
        control=False,
    )

    if layer.get("overlay_tiles"):
        folium.TileLayer(
            tiles=layer["overlay_tiles"],
            attr=layer.get("overlay_attr", layer["attr"]),
            name=f"{layer['label']} labels",
            overlay=True,
            control=False,
            max_zoom=layer.get("max_zoom", 19),
        ).add_to(m)

    if map_style == "tec_heatmap":
        heat_points = [
            [station.lat, station.lon, map_tec_values[station.code][0]]
            for station in station_list
            if map_tec_values[station.code][0] > 0
        ]
        if heat_points:
            HeatMap(
                heat_points,
                name="VTEC intensity",
                min_opacity=0.3,
                max_zoom=10,
                radius=48,
                blur=34,
                gradient={
                    0.15: "#000080",
                    0.35: "#0080ff",
                    0.55: "#00ff80",
                    0.75: "#ffcc00",
                    1.0: "#ff0000",
                },
            ).add_to(m)

            if show_tec_legend:
                tec_values = [point[2] for point in heat_points]
                tec_min = math.floor(min(tec_values) * 2) / 2
                tec_max = math.ceil(max(tec_values) * 2) / 2
                if math.isclose(tec_min, tec_max):
                    tec_min -= 0.5
                    tec_max += 0.5

                half_tecu_steps = int(round((tec_max - tec_min) * 2))
                if half_tecu_steps <= 10:
                    tick_values = [
                        tec_max - index * 0.5
                        for index in range(half_tecu_steps + 1)
                    ]
                else:
                    tick_values = [
                        tec_max - index * (tec_max - tec_min) / 5
                        for index in range(6)
                    ]

                tick_denominator = max(1, len(tick_values) - 1)
                tick_html = "".join(
                    f"<span style='position:absolute;top:"
                    f"{index * 100 / tick_denominator:.2f}%;"
                    f"left:48px;transform:translateY(-50%);white-space:nowrap;"
                    f"color:#fff;font-size:12px'>{value:.1f}</span>"
                    for index, value in enumerate(tick_values)
                )
                legend = MacroElement()
                legend._template = Template(
                    """
                    {% macro html(this, kwargs) %}
                    <div style="
                        position: fixed;
                        top: 70px;
                        right: 18px;
                        z-index: 9999;
                        width: 118px;
                        height: 328px;
                        padding: 12px 10px;
                        background: rgba(6, 13, 26, 0.92);
                        border: 1px solid #334155;
                        border-radius: 8px;
                        box-shadow: 0 8px 24px rgba(0,0,0,0.35);
                        font-family: sans-serif;
                    ">
                        <div style="color:#fff;font-size:12px;font-weight:800;
                                    text-align:center;margin-bottom:8px">
                            VTEC (TECU)
                        </div>
                        <div style="position:relative;height:276px;margin-left:9px">
                            <div style="
                                position:absolute;
                                left:0;
                                top:0;
                                width:30px;
                                height:100%;
                                border:1px solid #475569;
                                background:linear-gradient(
                                    to top,
                                    #000080 0%,
                                    #0080ff 25%,
                                    #00ff80 50%,
                                    #ffcc00 75%,
                                    #ff0000 100%
                                );
                            "></div>
                            {{ this.tick_html | safe }}
                        </div>
                    </div>
                    {% endmacro %}
                    """
                )
                legend.tick_html = tick_html
                m.get_root().add_child(legend)

    for station in station_list:
        tec_value, is_estimated = map_tec_values[station.code]
        use_tec_color = color_by == "tec" or map_style == "tec_heatmap"
        color = _tec_color(tec_value) if use_tec_color else _status_color(station.status)
        estimate_suffix = " (estimated)" if is_estimated else ""
        CircleMarker(
            location=[station.lat, station.lon],
            radius=10,
            color=color,
            fill=True,
            fill_color=color,
            fill_opacity=0.88,
            weight=2.5,
            tooltip=(
                f"{station.code.upper()} — {station.name} · "
                f"{tec_value:.1f} TECU{estimate_suffix}"
            ),
            popup=Popup(
                _station_popup_html(
                    station,
                    tec_value,
                    is_estimated,
                    updated_at,
                ),
                max_width=310,
            ),
        ).add_to(m)

    if station_list:
        m.fit_bounds(
            [
                [min(station.lat for station in station_list), min(station.lon for station in station_list)],
                [max(station.lat for station in station_list), max(station.lon for station in station_list)],
            ],
            padding=(24, 24),
        )

    return m


def map_style_selector(st_module, key: str = "cors_map_style", default: str = "hybrid") -> str:
    """Return the selected map layer key: hybrid, satellite, or street."""
    selected_label = st_module.radio(
        "Map layer",
        MAP_STYLE_OPTIONS,
        index=MAP_STYLE_KEYS.index(default),
        horizontal=True,
        label_visibility="collapsed",
        key=key,
    )
    return MAP_STYLE_KEYS[MAP_STYLE_OPTIONS.index(selected_label)]


def render_cors_station_map(
    st_module,
    stations: Iterable[CorsStation] | None = None,
    *,
    color_by: Literal["status", "tec"] = "status",
    map_style: str | None = None,
    height: int = 400,
    show_style_selector: bool = False,
    show_tec_legend: bool = False,
    key: str = "cors_map_style",
) -> None:
    """Render the Folium map in Streamlit with Hybrid / Satellite / Street layers."""
    try:
        from streamlit_folium import st_folium
    except ImportError as exc:
        raise ImportError(
            "streamlit-folium is required for the CORS map. Run: pip install streamlit-folium"
        ) from exc

    if show_style_selector:
        map_style = map_style_selector(st_module, key=key)
    elif map_style is None:
        map_style = "hybrid"

    station_list = list(stations if stations is not None else ZIMBABWE_CORS_STATIONS)
    folium_map = build_cors_folium_map(
        station_list,
        color_by=color_by,
        map_style=map_style,
        show_tec_legend=show_tec_legend,
    )
    station_signature = "-".join(
        f"{station.code}-{station.current_tec:.1f}"
        for station in station_list
    )
    st_folium(
        folium_map,
        width=None,
        height=height,
        returned_objects=[],
        key=f"{key}_map_{map_style}_{station_signature}",
    )
