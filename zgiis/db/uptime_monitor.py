"""Durable, confirmed Spider transitions; existing archives remain untouched."""
from datetime import datetime, timezone
import os
import uuid

from zgiis.db.config import schema_init_enabled


class _DirectMonitorConnection:
    """One Postgres connection that is closed when the check finishes.

    The session pool is capped. Holding a checkout there is what made the
    station-uptime page report that the database was not configured.
    """

    def __init__(self, conn, dsn: str):
        self._dsn = dsn
        self._is_pg = True
        self._conn = conn

    def close(self) -> None:
        conn = self._conn
        self._conn = None
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def _open_monitor_db():
    import psycopg2

    from zgiis.db.config import DatabaseUnavailable, ensure_sslmode, pooled_database_dsn

    candidates: list[str] = []
    for dsn in (
        pooled_database_dsn(),
        ensure_sslmode(os.getenv("SUPABASE_DATABASE_URL") or ""),
    ):
        if dsn and dsn not in candidates:
            candidates.append(dsn)
    if not candidates:
        raise DatabaseUnavailable("SUPABASE_DATABASE_URL is not configured")
    last_error: Exception | None = None
    for dsn in candidates:
        try:
            conn = psycopg2.connect(dsn, connect_timeout=5)
        except Exception as exc:
            last_error = exc
            continue
        conn.autocommit = True
        return _DirectMonitorConnection(conn, dsn)
    raise DatabaseUnavailable("Supabase Postgres init failed") from last_error


class UptimeMonitorDB:
    def __init__(self, db=None):
        self.db = db if db is not None else _open_monitor_db()
        if self.db._dsn and not self.db._is_pg:
            self.db.close()
            raise RuntimeError('Configured monitoring database unavailable; refusing a separate local archive')
        self.conn = self.db._conn
        if schema_init_enabled():
            for ddl in (
                "CREATE TABLE IF NOT EXISTS uptime_monitor_state (station_code TEXT PRIMARY KEY, status TEXT NOT NULL, candidate TEXT, consecutive INTEGER NOT NULL, observed_at TEXT NOT NULL)",
                "CREATE TABLE IF NOT EXISTS uptime_incidents (id TEXT PRIMARY KEY, station_code TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT)",
                "CREATE UNIQUE INDEX IF NOT EXISTS uptime_one_open_incident ON uptime_incidents(station_code) WHERE ended_at IS NULL",
                "CREATE TABLE IF NOT EXISTS uptime_monitor_events (id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, station_code TEXT NOT NULL, event_type TEXT NOT NULL, time TEXT NOT NULL, UNIQUE(incident_id, event_type))",
                "CREATE TABLE IF NOT EXISTS uptime_monitor_health (id INTEGER PRIMARY KEY, owner TEXT, lease_until REAL NOT NULL, checked_at TEXT, successful_at TEXT, error TEXT)",
            ):
                self.execute(ddl)
        # The lease row is data, not DDL. Truncation and a fresh database both
        # need it, and autocommit closes the statement immediately.
        self.execute(
            "INSERT INTO uptime_monitor_health(id, lease_until) VALUES (1, 0) ON CONFLICT(id) DO NOTHING"
        )

    def execute(self, sql, args=()):
        cur = self.conn.cursor()
        cur.execute(sql.replace('?', '%s') if self.db._is_pg else sql, args)
        return cur

    def observe(self, rows, *, owner, now=None, error=None, confirmations=3):
        """One transaction owns the lease, confirms changes and appends archives."""
        now = now or datetime.now(timezone.utc)
        stamp, epoch = now.isoformat(), now.timestamp()
        previous = self.conn.autocommit
        self.conn.autocommit = False
        try:
            if not self.db._is_pg:
                self.execute('BEGIN IMMEDIATE')
            claimed = self.execute(
                'UPDATE uptime_monitor_health SET owner=?, lease_until=? WHERE id=1 AND (owner=? OR lease_until<?)',
                (owner, epoch + 90, owner, epoch),
            ).rowcount
            if not claimed:
                self.conn.rollback()
                return False
            self.execute('UPDATE uptime_monitor_health SET checked_at=?, error=? WHERE id=1', (stamp, error))
            if error or not rows:
                # A broken monitor is never evidence of a station outage.
                self.execute('UPDATE uptime_monitor_state SET candidate=NULL, consecutive=0')
                self.conn.commit()
                return True
            self.execute('UPDATE uptime_monitor_health SET successful_at=? WHERE id=1', (stamp,))
            existing = self.execute('SELECT station_code,status,candidate,consecutive,observed_at FROM uptime_monitor_state').fetchall()
            states = {r[0]: r[1:] for r in existing}
            for code in states.keys() - rows.keys():
                self.execute('UPDATE uptime_monitor_state SET candidate=NULL, consecutive=0 WHERE station_code=?', (code,))
            for code, observed in rows.items():
                if observed not in ('online', 'offline'):
                    continue
                old = states.get(code)
                confirmed, candidate, count = observed, None, 0
                event, incident = None, None
                if old:
                    confirmed, prior_candidate, prior_count, seen = old
                    contiguous = (now - datetime.fromisoformat(seen)).total_seconds() <= 90
                    if observed != confirmed:
                        candidate = observed
                        count = prior_count + 1 if contiguous and prior_candidate == observed else 1
                        if count >= max(2, confirmations):
                            confirmed, candidate, count = observed, None, 0
                            if observed == 'offline':
                                incident = str(uuid.uuid4())
                                self.execute('INSERT INTO uptime_incidents(id,station_code,started_at) VALUES (?,?,?)', (incident, code, stamp))
                                event = 'DOWN'
                            else:
                                opened = self.execute('SELECT id FROM uptime_incidents WHERE station_code=? AND ended_at IS NULL', (code,)).fetchone()
                                if opened:
                                    incident, event = opened[0], 'UP'
                                    self.execute('UPDATE uptime_incidents SET ended_at=? WHERE id=?', (stamp, incident))
                self.execute('INSERT INTO uptime_monitor_state(station_code,status,candidate,consecutive,observed_at) VALUES (?,?,?,?,?) ON CONFLICT(station_code) DO UPDATE SET status=excluded.status,candidate=excluded.candidate,consecutive=excluded.consecutive,observed_at=excluded.observed_at', (code, confirmed, candidate, count, stamp))
                if event:
                    self.execute('INSERT INTO uptime_monitor_events(id,incident_id,station_code,event_type,time) VALUES (?,?,?,?,?)', (str(uuid.uuid4()), incident, code, event, stamp))
                    self.execute('INSERT INTO station_status_events(time,station_code,status,previous_status,event_type,api_reachable,source) VALUES (?,?,?,?,?,?,?)', (stamp, code, confirmed, old[0], 'site_down' if event == 'DOWN' else 'site_up', True, 'uptime_monitor'))
                self.execute('INSERT INTO station_status_snapshots(time,station_code,status,api_reachable,source) VALUES (?,?,?,?,?)', (stamp, code, confirmed, True, 'uptime_monitor'))
            self.conn.commit()
            return True
        except Exception:
            self.conn.rollback()
            raise
        finally:
            self.conn.autocommit = previous

    def report(self, *, hours=168, station=None):
        from datetime import timedelta
        from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
        now = datetime.now(timezone.utc)
        names = {s.code.lower().rstrip('_'): s.name for s in ZIMBABWE_CORS_STATIONS}
        health = self.execute('SELECT checked_at,successful_at,error FROM uptime_monitor_health WHERE id=1').fetchone()
        checked, successful, error = health or (None, None, None)
        alive = bool(checked and (now - datetime.fromisoformat(checked)).total_seconds() < 90)
        args = [(now - timedelta(hours=hours)).isoformat()]
        where = ''
        if station:
            where = ' AND e.station_code=?'
            args.append(station.lower().rstrip('_'))
        rows = self.execute('SELECT e.id,e.station_code,e.event_type,e.time,i.started_at,i.ended_at FROM uptime_monitor_events e JOIN uptime_incidents i ON i.id=e.incident_id WHERE (e.time>=? OR i.ended_at IS NULL)' + where + ' ORDER BY e.time DESC LIMIT 100', args).fetchall()
        return {
            'status': 'stopped' if not alive else 'communication_error' if error else 'monitoring',
            'checked_at': checked, 'successful_at': successful, 'error': error,
            'tracked': self.execute('SELECT COUNT(*) FROM uptime_monitor_state').fetchone()[0],
            'events': [dict(id=r[0], station_code=r[1], station_name=names.get(r[1], r[1].upper()), event_type=r[2], time=r[3], started_at=r[4], ended_at=r[5]) for r in rows],
        }

    def close(self):
        self.db.close()
