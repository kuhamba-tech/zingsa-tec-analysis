import unittest
from unittest.mock import patch

from zgiis.cors.stations import CorsStation
from zgiis.maps.station_map import (
    TILE_LAYERS,
    _render_folium_map,
    build_cors_folium_map,
    render_cors_station_map,
)


class StationMapSwitchingTests(unittest.TestCase):
    def setUp(self):
        self.stations = [
            CorsStation(
                code="hara",
                name="Harare",
                lat=-17.78,
                lon=31.05,
                status="unknown",
            )
        ]

    def test_all_four_map_styles_build(self):
        for style in ("hybrid", "satellite", "street", "tec_heatmap"):
            with self.subTest(style=style):
                html = build_cors_folium_map(
                    self.stations,
                    map_style=style,
                ).get_root().render()
                self.assertIn(TILE_LAYERS[style]["tiles"], html)

    def test_heat_map_does_not_generate_illustrative_values(self):
        html = build_cors_folium_map(
            self.stations,
            map_style="tec_heatmap",
            show_tec_legend=True,
        ).get_root().render()

        self.assertNotIn("illustrative", html.lower())
        self.assertNotIn("VTEC intensity", html)

    def test_single_station_heatmap_uses_reliable_tiles_and_regional_zoom(self):
        station = CorsStation(
            code="karo",
            name="Karoi",
            lat=-16.81896637,
            lon=29.68364577,
            status="online",
            current_tec=12.5,
        )

        html = build_cors_folium_map(
            [station],
            map_style="tec_heatmap",
            show_tec_legend=True,
        ).get_root().render()

        self.assertIn("tile.openstreetmap.org", html)
        self.assertIn('"zoom": 7', html)
        self.assertNotIn("fitBounds(", html)
        self.assertIn("12.5 TECU", html)

    def test_folium_component_has_stable_key_and_no_return_payload(self):
        folium_map = build_cors_folium_map(self.stations, map_style="hybrid")

        with patch("streamlit_folium.st_folium") as st_folium:
            _render_folium_map(
                None,
                folium_map,
                height=400,
                key="test_map",
                map_style="hybrid",
            )

        kwargs = st_folium.call_args.kwargs
        self.assertEqual(kwargs["height"], 400)
        self.assertEqual(kwargs["key"], "test_map_folium_hybrid")
        self.assertTrue(kwargs["use_container_width"])
        self.assertEqual(kwargs["returned_objects"], [])

    def test_renderer_falls_back_to_plotly_without_raising(self):
        with (
            patch(
                "zgiis.maps.station_map._render_folium_map",
                side_effect=RuntimeError("component failed"),
            ),
            patch("zgiis.maps.station_map._render_plotly_map") as plotly,
        ):
            render_cors_station_map(
                object(),
                self.stations,
                map_style="hybrid",
                key="fallback_map",
            )

        plotly.assert_called_once()

    def test_renderer_reports_compact_error_if_both_renderers_fail(self):
        class StreamlitStub:
            def __init__(self):
                self.messages = []

            def error(self, message):
                self.messages.append(message)

        streamlit = StreamlitStub()
        with (
            patch(
                "zgiis.maps.station_map._render_folium_map",
                side_effect=RuntimeError("component failed"),
            ),
            patch(
                "zgiis.maps.station_map._render_plotly_map",
                side_effect=RuntimeError("fallback failed"),
            ),
        ):
            render_cors_station_map(
                streamlit,
                self.stations,
                map_style="hybrid",
                key="failed_map",
            )

        self.assertEqual(len(streamlit.messages), 1)
        self.assertIn("could not be rendered", streamlit.messages[0])


if __name__ == "__main__":
    unittest.main()
