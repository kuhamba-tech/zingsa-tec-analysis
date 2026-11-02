"""Slow live-status database reads must not stall unrelated API requests."""
import asyncio
import threading
import unittest
from unittest.mock import patch

import httpx
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


if __name__ == '__main__':
    unittest.main()
