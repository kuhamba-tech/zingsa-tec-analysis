from concurrent.futures import Future
from datetime import date

import pytest


def setup_service(monkeypatch):
    from zgiis.processing import receiver_bias_service as service
    future=Future()
    calls=[]
    class Pool:
        def submit(self,fn,*args): calls.append(args); return future
    monkeypatch.setattr(service,"_pool",Pool())
    monkeypatch.setattr(service,"_entries",{})
    return service,future,calls


def test_bias_requests_share_one_read_and_return_real_archive(monkeypatch):
    service,future,calls=setup_service(monkeypatch)
    assert service.chart_response()["status"]=="loading"
    assert service.chart_response()["status"]=="loading"
    assert len(calls)==1
    data={"stations":[{"station":"masv","points":[{"day":"2026-10-30","bias_tecu":-3.2}]}],"note":"Measured archive"}
    future.set_result(data)
    response=service.chart_response()
    assert response["status"]=="ready" and response["stations"]==data["stations"]
    assert response["checked_at"] and len(calls)==1


def test_archive_failure_is_unavailable_not_successful_empty_data(monkeypatch):
    service,future,_=setup_service(monkeypatch)
    service.chart_response()
    future.set_exception(RuntimeError("private connection information"))
    response=service.chart_response()
    assert response["status"]=="unavailable" and response["stations"]==[]
    assert "private" not in str(response)


def test_refresh_failure_preserves_real_data_with_stale_warning(monkeypatch):
    service,future,_=setup_service(monkeypatch)
    service.chart_response()
    future.set_result({"stations":[{"station":"beit"}],"note":"Measured archive"})
    service.chart_response()
    failed=Future();failed.set_exception(RuntimeError("offline"))
    service._entries[120]["job"]=failed
    response=service.chart_response()
    assert response["status"]=="stale" and response["stations"]==[{"station":"beit"}]


def test_empty_success_is_distinct_from_outage(monkeypatch):
    service,future,_=setup_service(monkeypatch)
    service.chart_response()
    future.set_result({"stations":[],"note":"No archived estimates"})
    assert service.chart_response()["status"]=="ready"


def test_serverless_request_can_collect_finished_read_before_returning(monkeypatch):
    service,future,calls=setup_service(monkeypatch)
    future.set_result({"stations":[{"station":"masv"}],"note":"Real archive"})
    response=service.chart_response(wait_seconds=1)
    assert response["status"]=="ready" and response["stations"]==[{"station":"masv"}]
    assert len(calls)==1


def test_pooler_connection_failure_retries_configured_session_endpoint(monkeypatch):
    import psycopg2
    from zgiis.db import receiver_bias_db as db, config
    calls=[];closed=[]
    class Cursor:
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def execute(self,*args): pass
        def fetchall(self): return []
    class Connection:
        def cursor(self): return Cursor()
        def close(self): closed.append(True)
    def connect(dsn,**kwargs):
        calls.append(dsn)
        assert kwargs["connect_timeout"]==4
        if dsn=="test-pooler": raise psycopg2.OperationalError("authentication timeout")
        return Connection()
    monkeypatch.setattr(config,"pooled_database_dsn",lambda:"test-pooler")
    monkeypatch.setattr(config,"_session_dsn",lambda:"test-session")
    monkeypatch.setattr(psycopg2,"connect",connect)
    assert db.read_series()==[]
    assert calls==["test-pooler","test-session"] and closed==[True]


def test_archive_read_avoids_exhausted_general_pool_and_request_ddl(monkeypatch):
    import psycopg2
    from zgiis.db import receiver_bias_db as db, config
    queries=[];closed=[]
    class Cursor:
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def execute(self,sql,params=None): queries.append(sql)
        def fetchall(self): return [("masv",date(2026,10,30),-3.25,12,"code_dcb_receiver_estimate")]
    class Connection:
        def cursor(self): return Cursor()
        def close(self): closed.append(True)
    monkeypatch.setattr(config,"pooled_database_dsn",lambda:"test-only")
    monkeypatch.setattr(psycopg2,"connect",lambda *args,**kw:Connection())
    monkeypatch.setattr(db,"checkout",lambda:pytest.fail("general connection pool must not be used"))
    result=db.read_series()
    assert result[0]["points"][0]["bias_tecu"]==-3.25
    assert closed and any("statement_timeout" in q for q in queries)
    assert all("CREATE" not in q for q in queries)
    def fail_query(*args,**kwargs): raise RuntimeError("query timed out")
    monkeypatch.setattr(Cursor,"execute",fail_query)
    with pytest.raises(RuntimeError,match="query timed out"): db.read_series()
    assert len(closed)==2
