import unittest
import pandas as pd
from zgiis.processing.tec_climatology import summarize, season_key, magnetic_latitude
from zgiis.processing.north_south_tec_research import zimbabwe_lat_band


class ClimatologyTests(unittest.TestCase):
    def test_station_balancing(self):
        rows=pd.DataFrame([{'station':'a','region':'northern','hour':'12','vtec':10,'observations':100}]*10+
                          [{'station':'b','region':'northern','hour':'12','vtec':30,'observations':1}])
        result=summarize(rows,'hour',lambda _:10,{'northern':['a','b']})[0]
        self.assertEqual(result['mean'],20)
        self.assertEqual(result['completeness_pct'],55)

    def test_fixed_map_boundaries(self):
        self.assertEqual(zimbabwe_lat_band(-18.19),'northern')
        self.assertEqual(zimbabwe_lat_band(-18.2),'central')
        self.assertEqual(zimbabwe_lat_band(-20.2),'southern')

    def test_december_january_same_season(self):
        self.assertEqual(season_key(12,2025),season_key(1,2026))
        self.assertNotEqual(season_key(1,2025),season_key(12,2025))

    def test_geomagnetic_validity(self):
        self.assertIsNone(magnetic_latitude(-18,30,2020))
        self.assertTrue(-90<magnetic_latitude(-18,30,2026)<90)

    def test_missing_data_stays_empty(self):
        self.assertEqual(summarize(pd.DataFrame(),'hour',lambda _:24,{}),[])
