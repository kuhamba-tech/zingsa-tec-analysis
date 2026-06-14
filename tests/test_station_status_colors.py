import unittest

from zgiis.maps.station_map import _status_color, _status_label


class StationStatusColorTests(unittest.TestCase):
    def test_offline_is_red(self):
        self.assertEqual(_status_color("offline"), "#ef4444")
        self.assertEqual(_status_label("offline"), "OFFLINE")

    def test_missing_telemetry_is_grey_and_not_called_offline(self):
        self.assertEqual(_status_color("unknown"), "#94a3b8")
        self.assertEqual(_status_label("unknown"), "TELEMETRY UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
