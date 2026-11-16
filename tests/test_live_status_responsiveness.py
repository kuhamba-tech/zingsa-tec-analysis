"""Slow live-status database reads must not stall unrelated API requests."""
import asyncio
import threading
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import pandas as pd
from fastapi import FastAPI

from backend.routers import live


class LiveStatusResponsivenessTests(unittest.IsolatedAsyncioTestCase):
    async def test_health_remains_responsive_during_status_database_read(self):
        for endpoint in (live.live_stations, live.pipeline_status):
            with self.subTest(endpoint=endpoint.__name__):
                entered = threading.Event()
                release = threading.Event()

                def slow_database():
                    entered.set()
                    release.wait(2)
                    return None

                app = FastAPI()
                app.add_api_route('/status', endpoint, methods=['GET'])
                app.dependency_overrides[live.require_api_key] = lambda: None

                @app.get('/health')
                async def health():
                    return {'ok': True}

                status = {'streams': {}, 'active_streams': 0, 'configured': False}
                with patch.object(live, '_db', slow_database), \
                     patch.object(live, '_monitor', return_value=None), \
                     patch('backend.live_manager.status', return_value=status), \
                     patch('zgiis.cors.stations.stations_for_map_live', return_value=[]):
                    async with httpx.AsyncClient(
                        transport=httpx.ASGITransport(app=app), base_url='http://test'
                    ) as client:
                        pending = asyncio.create_task(client.get('/status'))
                        try:
                            started = await asyncio.to_thread(entered.wait, 3)
                            self.assertTrue(started)
                            # If the route blocks the event loop, its bounded read
                            # already finished before this coroutine can resume.
                            self.assertFalse(pending.done())
                            response = await asyncio.wait_for(client.get('/health'), 0.5)
                            self.assertEqual(response.status_code, 200)
                            self.assertFalse(release.is_set())
                        finally:
                            release.set()
                            await pending

    def test_station_tec_fallback_reads_the_full_rotation_window(self):
        class LegacyDB:
            requested_hours = None

            def query_recent(self, *, hours):
                self.requested_hours = hours
                now = datetime.now(timezone.utc)
                return pd.DataFrame(
                    [
                        {
                            "station": "hara",
                            "time": now - timedelta(minutes=10),
                            "vtec_tecu": 28.0,
                            "tec_method": "gopi_eq_4_11_code_live",
                        },
                        {
                            "station": "hara",
                            "time": now - timedelta(minutes=5),
                            "vtec_tecu": 90.0,
                            "tec_method": "daily_archive",
                        },
                    ]
                )

        db = LegacyDB()
        with patch("backend.live_manager.status", return_value={"streams": {}}), \
             patch("zgiis.cors.stations.stations_for_map_live", return_value=[
                 SimpleNamespace(code="hara", name="Harare", lat=-17.8, lon=31.0, current_tec=None)
             ]), \
             patch.object(live, "_monitor", return_value=None), \
             patch.object(live, "_db", return_value=db):
            result = live.live_stations()

        assert db.requested_hours == 20.0 / 60.0
        assert result[0].last_vtec == 28.0
        assert result[0].stale is False


if __name__ == '__main__':
    unittest.main()
