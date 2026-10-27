import unittest

from zgiis.live.connected_rotation import ConnectedStationGate


class ConnectedStationGateTests(unittest.TestCase):
    def test_surveyor_general_never_takes_the_slot(self):
        gate = ConnectedStationGate()
        gate.replace({"bula", "kwek"})
        self.assertTrue(gate.waiting("bula"))
        self.assertFalse(gate.waiting("kwek"))

    def test_offline_stations_wait_when_spider_lists_online_sites(self):
        gate = ConnectedStationGate()
        gate.update_from_spider({
            "by_station": {
                "kwek": {"status": "online"},
                "gutu": {"status": "offline"},
                "hara": {"status": "online"},
            }
        })
        self.assertFalse(gate.waiting("kwek"))
        self.assertTrue(gate.waiting("gutu"))
        self.assertTrue(gate.waiting("hara"))

    def test_missing_spider_list_still_connects_zingsa_stations(self):
        gate = ConnectedStationGate()
        gate.update_from_spider({"by_station": {}})
        self.assertFalse(gate.waiting("vicf"))
        self.assertTrue(gate.waiting("masv"))
