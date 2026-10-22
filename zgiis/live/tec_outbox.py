"""Durable pending live measurements, replayed after collector restarts."""
import hashlib
import json
import sqlite3
import threading
from pathlib import Path


class TecOutbox:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.conn=sqlite3.connect(str(path),timeout=15,check_same_thread=False)
        self.lock=threading.RLock()
        self.conn.execute('PRAGMA journal_mode=WAL')
        self.conn.execute('PRAGMA synchronous=FULL')
        self.conn.execute('CREATE TABLE IF NOT EXISTS pending (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
        self.conn.commit()

    @staticmethod
    def key(row):
        values=[row.get(k,'') for k in ('epoch','station','constellation','prn','tec_method')]
        return hashlib.sha256(json.dumps(values,default=lambda x:x.isoformat()).encode()).hexdigest()

    def stage(self, row):
        with self.lock:
            self.conn.execute('INSERT OR IGNORE INTO pending VALUES (?,?)',(self.key(row),json.dumps(row,default=lambda x:x.isoformat())))
            self.conn.commit()

    def replay(self):
        with self.lock:
            return [json.loads(row[0]) for row in self.conn.execute('SELECT payload FROM pending')]

    def acknowledge(self, rows):
        with self.lock:
            self.conn.executemany('DELETE FROM pending WHERE id=?',[(self.key(row),) for row in rows])
            self.conn.commit()
