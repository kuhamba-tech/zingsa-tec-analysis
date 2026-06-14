import unittest

from zgiis.cors.stations import CorsStation
from zgiis.maps.station_map import _render_plotly_map


class _StreamlitStub:
    def __init__(self):
        self.figure = None

    def plotly_chart(self, figure, **kwargs):
        self.figure = figure


class StationPlotlyMapTests(unittest.TestCase):
    def test_scattermap_marker_uses_supported_properties(self):
        streamlit = _StreamlitStub()
        stations = [
            CorsStation(
                code="hara",
                name="Harare",
                lat=-17.78,
                lon=31.05,
                status="offline",
            )
        ]

        _render_plotly_map(
            streamlit,
            stations,
            color_by="status",
            map_style="hybrid",
            height=400,
            key="test",
        )

        self.assertIsNotNone(streamlit.figure)
        marker = streamlit.figure.data[0].marker.to_plotly_json()
        self.assertNotIn("line", marker)
        self.assertEqual(marker["color"], ["#ef4444"])


if __name__ == "__main__":
    unittest.main()
