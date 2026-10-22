import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from zgiis.db.station_status_db import StationStatusDB
from zgiis.db.uptime_monitor import UptimeMonitorDB


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'monitor.sqlite'
        self.path.touch()
        self.patch = patch('zgiis.db.station_status_db._SQLITE_PATH', self.path)
        self.patch.start()
        self.db = UptimeMonitorDB(StationStatusDB(dsn=''))
        self.now = datetime.now(timezone.utc)

    def tearDown(self):
        self.db.close()
        self.patch.stop()
        self.temp.cleanup()

    def check(self, status, error=None, owner='worker'):
        self.now += timedelta(seconds=30)
        return self.db.observe({'hara': status}, owner=owner, now=self.now, error=error)

    def test_initial_offline_is_only_baseline(self):
        for _ in range(4): self.check('offline')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM uptime_incidents').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM station_status_events').fetchone()[0], 0)

    def test_confirmation_restart_recovery_and_deduplication(self):
        self.check('online')
        self.check('offline')
        self.check('offline')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM uptime_incidents').fetchone()[0], 0)
        self.db.close()
        self.db = UptimeMonitorDB(StationStatusDB(dsn=''))
        self.check('offline')
        self.check('offline')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM uptime_incidents').fetchone()[0], 1)
        for _ in range(3): self.check('online')
        self.check('online')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM uptime_monitor_events').fetchone()[0], 2)
        self.assertIsNotNone(self.db.execute('SELECT ended_at FROM uptime_incidents').fetchone()[0])

    def test_communication_failure_resets_confirmation(self):
        self.check('online')
        self.check('offline')
        self.check('offline', error='timeout')
        self.check('offline')
        self.check('offline')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM uptime_incidents').fetchone()[0], 0)

    def test_second_worker_cannot_write(self):
        self.check('online')
        self.assertFalse(self.check('offline', owner='other'))

    def test_gap_requires_fresh_confirmation(self):
        self.check('online')
        self.check('offline')
        self.check('offline')
        self.now += timedelta(minutes=5)
        self.check('offline')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM uptime_incidents').fetchone()[0], 0)
