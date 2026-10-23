import unittest

from zgiis.space_weather.igrf14 import (
    anomaly_paths,
    dip_latitude_deg,
    eia_region,
    field_geodetic,
    inclination_deg,
)


class Igrf14DipTests(unittest.TestCase):
    def test_addis_ababa_is_on_the_magnetic_equator(self):
        """Oryema et al. (2015) Table 1 puts ADIS on the magnetic equator."""
        dip = dip_latitude_deg(9.03, 38.77, 2015.0)
        self.assertGreater(dip, -2.0)
        self.assertLess(dip, 3.0)
        self.assertLess(abs(inclination_deg(9.03, 38.77, 2015.0)), 6.0)

    def test_lusaka_is_poleward_of_the_southern_crest(self):
        dip = dip_latitude_deg(-15.4, 28.3, 2015.0)
        self.assertLess(dip, -20.0)
        self.assertEqual(eia_region(dip), "Poleward of the southern crest")

    def test_crest_paths_hit_their_dip_latitudes(self):
        paths = anomaly_paths(2026.8, 30.0, 30.0, 1.0)
        trough_lat = paths["trough"][0][1]
        crest_lat = paths["southern_crest"][0][1]
        self.assertAlmostEqual(dip_latitude_deg(trough_lat, 30.0, 2026.8), 0.0, delta=0.05)
        self.assertAlmostEqual(dip_latitude_deg(crest_lat, 30.0, 2026.8), -15.0, delta=0.05)
        self.assertGreater(trough_lat, 6.0)
        self.assertLess(crest_lat, 0.0)

    def test_dip_equator_circles_the_earth(self):
        paths = anomaly_paths(2026.8)
        trough = paths["trough"]
        self.assertLess(trough[0][0], -170)
        self.assertGreater(trough[-1][0], 170)
        africa = next(lat for lon, lat in trough if abs(lon - 30) < 1.5)
        peru = next(lat for lon, lat in trough if abs(lon - (-75)) < 1.5)
        self.assertGreater(africa, 6)
        self.assertLess(peru, 0)
        self.assertGreater(peru, -20)

    def test_harare_field_is_a_southern_midlatitude_field(self):
        north, east, down = field_geodetic(-17.83, 31.05, 2026.8)
        strength = (north * north + east * east + down * down) ** 0.5
        self.assertGreater(strength, 25000)
        self.assertLess(strength, 40000)
        self.assertLess(inclination_deg(-17.83, 31.05, 2026.8), -45)
        self.assertGreater(inclination_deg(-17.83, 31.05, 2026.8), -70)
