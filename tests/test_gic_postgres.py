"""Opt-in integration checks. Only connection-local TEMP tables receive test data."""
import os
import threading
from pathlib import Path
import pytest


@pytest.fixture
def db():
    if os.getenv("GIC_TEST_DATABASE") != "1":
        pytest.skip("Set GIC_TEST_DATABASE=1 for isolated Postgres TEMP-table tests")
    import psycopg2
    from zgiis.db.config import database_dsn, load_shared_database_env, execute_script
    from zgiis.db.gic_db import GicDB, _DDL
    load_shared_database_env()
    connection = psycopg2.connect(database_dsn(), connect_timeout=8)
    connection.autocommit = True
    migration = Path("zgiis/db/gic_operations.sql").read_text(encoding="utf-8")
    # Shadow production names in this session. No permanent table receives data.
    with connection.cursor() as cursor:
        cursor.execute("SET statement_timeout='15s'")
        execute_script(cursor, _DDL.replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE"))
        for statement in migration.split(";"):
            statement="\n".join(line for line in statement.splitlines() if not line.startswith("--")).strip()
            if not statement or "ROW LEVEL SECURITY" in statement: continue
            if "CREATE TABLE IF NOT EXISTS" in statement:
                statement=statement.replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE")
            cursor.execute(statement)
    instance=GicDB.__new__(GicDB)
    instance._conn=connection; instance._lock=threading.RLock(); instance._dsn=""
    yield instance
    instance._conn=None
    connection.close()


def test_duplicate_conflict_provenance_and_threshold_persistence(db):
    row={"time":"2026-01-01T02:00:00+02:00","station_id":"DEMA_001","gic_a":-12.123456,"calibration_id":"cal-1","quality_flags":["review"],"source":"test-temp-only"}
    assert db.insert_rows([row])==1
    assert db.insert_rows([{**row,"time":"2026-01-01T00:00:00Z"}])==0
    assert db.record_count()==1
    with pytest.raises(ValueError,match="Conflicting"):
        db.insert_rows([{**row,"gic_a":7}])
    data=db.query_dataframe(station_id="DEMA_001",hours=None)
    assert data.gic_a.iloc[0]==-12.123456
    assert data.original_time.iloc[0]==row["time"]
    assert data.quality_flags.iloc[0]==["review"]
    assert data.metadata.iloc[0]["calibration_id"]=="cal-1"
    config={"thresholds_a":[3,6,12,24],"engineer_approval_reference":"TEMP-test"}
    db.save_station_config("DEMA_001",config)
    assert db.station_config("dema_001")==config
    assert db.receipt("DEMA_001")["inserted"]==0
    with db._conn.cursor() as cursor:
        cursor.execute("SELECT count(*) FROM gic_config_audit")
        assert cursor.fetchone()[0]==1


def test_api_ingestion_upload_series_report_flow(db, monkeypatch):
    from datetime import datetime, timedelta, timezone
    import pandas as pd
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routers import gic
    from backend.deps import require_api_key
    monkeypatch.setattr(gic, "_db", lambda: db)
    monkeypatch.setattr(gic, "_sw_context", lambda hours: pd.DataFrame())
    app=FastAPI(); app.include_router(gic.router)
    app.dependency_overrides[require_api_key]=lambda: "test"
    client=TestClient(app)
    stamp=(datetime.now(timezone.utc)-timedelta(hours=1)).isoformat()
    body={"station_id":"DEMA_001","readings":[{"time":stamp,"gic_a":-12.123456,"calibration_id":"TEMP-cal"}]}
    assert client.post('/gic/ingest',json=body).json()['inserted']==1
    assert client.post('/gic/ingest',json=body).json()['inserted']==0
    body['readings'][0]['gic_a']=5
    assert client.post('/gic/ingest',json=body).status_code==409
    series=client.get('/gic/series?station_id=DEMA_001').json()
    assert series['points'][0]['observed']==-12.123456
    assert series['points'][0]['predicted'] is None
    assert series['alerts']==[]
    assert client.get('/gic/report?station_id=DEMA_001&period=yearly').json()['statistics']['peak_abs_a']==12.123456
    exported=client.get('/gic/report?station_id=DEMA_001&format=csv')
    assert exported.status_code==200 and 'original_time' in exported.text and '-12.123456' in exported.text
    uploaded=client.post('/gic/upload',data={'station_id':'ALASKA_001','logger_timezone':'Africa/Harare'},files={'file':('logger.csv',f'TIMESTAMP,GIC_A\n{stamp},3.25\n','text/csv')})
    assert uploaded.status_code==201 and uploaded.json()['inserted']==1
    assert db.record_count()==2
