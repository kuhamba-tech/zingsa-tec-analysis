"""Dashboard requests must not queue behind slow chart or database work."""
import asyncio
import threading
import time
import unittest
from unittest.mock import Mock, patch

import httpx
import pandas as pd
from fastapi import FastAPI

from backend.routers import space_weather as routes
from backend.schemas import SpaceWeatherTimelines
from backend.timeline_builder import build_timelines


class DashboardConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_slow_timeline_does_not_block_other_requests(self):
        app = FastAPI()
        app.include_router(routes.router)
        app.dependency_overrides[routes.require_api_key] = lambda: ""

        @app.get("/health")
        async def health():
            return {"ok": True}

        started = threading.Event()
        release = threading.Event()

        def slow_build(_):
            started.set()
            release.wait(2)
            return SpaceWeatherTimelines()

        with patch.object(routes, "_sw", return_value={}), patch.object(routes, "build_timelines", side_effect=slow_build):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                slow = asyncio.create_task(client.get("/space-weather/timelines"))
                try:
                    self.assertTrue(await asyncio.to_thread(started.wait, 1))
                    response = await client.get("/health")
                    self.assertEqual(response.status_code, 200)
                    self.assertFalse(release.is_set())
                    self.assertFalse(slow.done(), "Chart work blocked the event loop")
                finally:
                    release.set()
                    self.assertEqual((await slow).status_code, 200)


class DashboardDatabaseTests(unittest.TestCase):
    def test_slow_mean_query_has_real_deadline_and_is_shared(self):
        release = threading.Event()

        def slow_read():
            release.wait(2)
            return time.monotonic(), 18.5

        with patch.object(routes, "_mean_vtec_future", None), patch.object(routes, "_read_mean_vtec", side_effect=slow_read) as read:
            try:
                start = time.monotonic()
                self.assertIsNone(routes._bounded_mean_vtec())
                self.assertLess(time.monotonic() - start, 0.8)
                self.assertIsNone(routes._bounded_mean_vtec())
                self.assertEqual(read.call_count, 1)
                release.set()
                routes._mean_vtec_future.result(timeout=1)
                self.assertEqual(routes._bounded_mean_vtec(), 18.5)
                self.assertEqual(read.call_count, 1)
            finally:
                release.set()
                if routes._mean_vtec_future:
                    routes._mean_vtec_future.result(timeout=2)

    def test_timelines_read_archive_once_and_keep_each_series(self):
        db = Mock()
        db.query_dataframe.return_value = pd.DataFrame([{
            "time": "2026-09-20T10:00:00Z", "gnss_risk_score": 1,
            "stations_online": 11, "mean_vtec": 18.5,
        }])
        with (
            patch("backend.space_weather_logger.get_db", return_value=db),
            patch("backend.timeline_builder.merge_timeline", side_effect=lambda _key, points: points),
            patch("zgiis.gic.timeline.load_gic_timeline", return_value=(None, [])),
        ):
            result = build_timelines({})
        db.query_dataframe.assert_called_once_with(hours=168.0, resample="1h")
        self.assertEqual(result.gnss_risk[0].v, 1)
        self.assertEqual(result.stations_online[0].v, 11)
        self.assertEqual(result.mean_vtec[0].v, 18.5)


if __name__ == "__main__":
    unittest.main()
