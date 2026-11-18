from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from backend.routers import live


def test_mapped_history_excludes_hidden_stations_and_aligns_receiver_bins(monkeypatch):
    import psycopg2

    day = (datetime.now(timezone.utc) - timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    cursor = MagicMock()
    cursor.fetchall.return_value = [
        ("gutu", day, day + timedelta(seconds=40), 20.0, 10),
        ("nkhr", day, day + timedelta(seconds=55), 40.0, 12),
        ("kari", day, day + timedelta(seconds=35), 45.0, 8),
    ]
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    monkeypatch.setattr(psycopg2, "connect", lambda *a, **kw: conn)
    monkeypatch.setattr(live, "_history_database_dsns", lambda: ["test-dsn"])
    rows = live._build_live_vtec_by_station(hours=24, resample_minutes=15,
        day=day.date().isoformat(), station_codes=("gutu", "nkhr", "hnus"))

    by_code = {row.station: row for row in rows}
    assert set(by_code) == {"gutu", "nkhr", "hnus"}
    assert by_code["gutu"].points[0].time == by_code["nkhr"].points[0].time
    assert by_code["hnus"].points == []
    sql, params = cursor.execute.call_args.args
    assert "= ANY(%s)" in sql
    assert set(params[-2]) == {"gutu", "nkhr", "hnus"}
    assert "kari" not in params[-2]
    conn.close.assert_called_once()


def test_default_history_retains_zimbabwe_catalog(monkeypatch):
    import psycopg2
    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

    day = (datetime.now(timezone.utc) - timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    cursor = MagicMock()
    cursor.fetchall.return_value = [("gutu", day, day + timedelta(seconds=40), 20.0, 10)]
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    monkeypatch.setattr(psycopg2, "connect", lambda *a, **kw: conn)
    monkeypatch.setattr(live, "_history_database_dsns", lambda: ["test-dsn"])
    rows = live._build_live_vtec_by_station(hours=24, resample_minutes=15, day=day.date().isoformat())
    assert {row.station for row in rows} == {s.code.lower().rstrip("_") for s in ZIMBABWE_CORS_STATIONS}
    assert "= ANY(%s)" not in cursor.execute.call_args.args[0]
