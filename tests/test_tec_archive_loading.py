"""Cold chart loads share one archive read and do not occupy the API event loop."""
import inspect
import threading
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

from backend.routers import tec
from zgiis.data import tec_archive


def test_parallel_chart_requests_share_one_cold_archive_load(monkeypatch):
    calls = []
    started = threading.Event()
    release = threading.Event()

    def load():
        calls.append(1)
        started.set()
        assert release.wait(5)
        return pd.DataFrame({"vtec": [12.0]}), {"available": True}

    monkeypatch.setattr(tec_archive, "load_anomaly_tec", load)
    monkeypatch.setattr(tec, "_ARCHIVE_CACHE", {"loaded_at": 0.0, "df": None, "meta": {}})
    with ThreadPoolExecutor(max_workers=5) as pool:
        jobs = [pool.submit(tec._archive_bundle) for _ in range(5)]
        assert started.wait(5)
        release.set()
        results = [job.result(timeout=5) for job in jobs]
    assert len(calls) == 1
    assert all(result[0].iloc[0]["vtec"] == 12.0 for result in results)


def test_blocking_archive_handlers_use_fastapi_worker_threads():
    for handler in [tec.archive_meta, tec.time_series, tec.diurnal, tec.seasonal, tec.solar_cycle]:
        assert not inspect.iscoroutinefunction(handler)


def test_date_filter_accepts_utc_observations_and_includes_the_last_day(monkeypatch):
    frame = pd.DataFrame({
        "timestamp": pd.to_datetime(["2026-11-11T23:59:00Z", "2026-11-12T00:00:00Z", "2026-11-12T23:59:00Z", "2026-11-13T00:00:00Z"]),
        "station": ["hara"] * 4,
        "vtec": [10.0, 11.0, 12.0, 13.0],
    })
    monkeypatch.setattr(tec, "_archive", lambda: frame)
    result = tec.time_series(station=None, start="2026-11-12", end="2026-11-12", limit=100)
    assert [row.vtec for row in result] == [11.0, 12.0]
    assert tec._vtec_by_date("2026-11-12", "2026-11-12", None) == {"2026-11-12": 11.5}
