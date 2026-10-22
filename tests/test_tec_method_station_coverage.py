import unittest
from unittest.mock import patch
from backend.routers.live import _build_tec_method_comparison
from backend.schemas import LiveObservation

class CoverageTests(unittest.TestCase):
 def test_each_station_gets_own_budget_and_calibration(self):
  calls=[]
  def samples(**kw):
   calls.append(kw)
   return [LiveObservation(time='2026-09-26T07:00:00Z',station=kw['station'],vtec_tecu=20,stec_tecu=30,elevation_deg=50,prn='G01')]
  groups=[]
  def calibrate(rows):
   groups.append({r['station'] for r in rows});return []
  with patch('backend.routers.live._build_live_vtec',side_effect=samples), patch('zgiis.processing.gg_calibration.calibrate_gg_from_observations',side_effect=calibrate):
   result=_build_tec_method_comparison(hours=2,station=None,limit=300)
  self.assertGreater(len(calls),1)
  self.assertEqual(len({c['station'] for c in calls}),len(calls))
  self.assertTrue(all(c['limit']==300 for c in calls))
  self.assertEqual(len(groups),len(calls))
  self.assertTrue(all(len(g)==1 for g in groups))

if __name__=='__main__': unittest.main()
