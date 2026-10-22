import sqlite3
import unittest
import tempfile
from pathlib import Path
from datetime import datetime, timezone
from unittest.mock import patch
from zgiis.db import timescale
from zgiis.live.stec_vtec import LiveVtecPipeline
from zgiis.live.tec_outbox import TecOutbox
from zgiis.processing.tec_climatology import build


class ResearchStorageTests(unittest.TestCase):
    def setUp(self):
        self.conn=sqlite3.connect(':memory:')
        self.conn.executescript(timescale._SQLITE_DDL)
        self.db=timescale.TecDB.__new__(timescale.TecDB)
        self.db._is_pg=False
        self.db._conn=self.conn
        self.db._dsn=''
        self.db._ensure_vtec_obs_audit_columns()
        self.shared=patch.object(timescale,'_SHARED_SQLITE_CONN',self.conn)
        self.shared.start()

    def tearDown(self):
        self.shared.stop()
        self.conn.close()

    def test_replay_idempotent_and_live_history_retained(self):
        row=dict(epoch=datetime(2020,1,1,tzinfo=timezone.utc),station='lupa',prn='G01',vtec_tecu=20,tec_method='gopi_eq_4_11_code_live')
        self.db.insert_vtec([row])
        self.db.insert_vtec([row])
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM vtec_obs').fetchone()[0],1)
        self.assertEqual(self.db.prune_older_than(7),0)
        self.assertIsNotNone(self.conn.execute('SELECT stored_at FROM vtec_obs').fetchone()[0])

    def test_failed_write_remains_pending(self):
        pipeline=LiveVtecPipeline(db=self.db)
        pipeline._pending=[{'test':'pending'}]
        with patch.object(self.db,'insert_vtec',return_value=0):
            pipeline.flush_db()
        self.assertEqual(len(pipeline._pending),1)

    def test_cat_boundary_and_incomplete_year(self):
        self.db.insert_vtec([dict(epoch=datetime(2025,12,31,23,30,tzinfo=timezone.utc),station='lupa',prn='G01',vtec_tecu=20,tec_method='gopi_eq_4_11_code_live')])
        cat=build(self.db,'2026-01-01','2026-12-31','CAT')
        utc=build(self.db,'2026-01-01','2026-12-31','UTC')
        self.assertEqual(cat['observations'],1)
        self.assertEqual(utc['observations'],0)
        self.assertEqual(cat['tables']['hour'][0]['period'],'01')
        self.assertEqual(cat['tables']['season'][0]['period'],'2026 December solstice')
        self.assertEqual(len(cat['expected_periods']['month']),12)
        self.assertLess(cat['tables']['month'][0]['completeness_pct'],1)

    def test_outbox_replays_restart_without_duplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'outbox.sqlite'
            box=TecOutbox(path)
            row=dict(epoch=datetime(2025,1,1,tzinfo=timezone.utc),station='lupa',prn='G01',vtec_tecu=20,tec_method='gopi_eq_4_11_code_live')
            box.stage(row)
            box.stage(row)
            box.conn.close()
            recovered=TecOutbox(path)
            pending=recovered.replay()
            self.assertEqual(len(pending),1)
            self.db.insert_vtec(pending)
            # Simulate crash between commit and acknowledgement.
            self.db.insert_vtec(pending)
            recovered.acknowledge(pending)
            self.assertEqual(recovered.replay(),[])
            self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM vtec_obs').fetchone()[0],1)
            recovered.conn.close()
