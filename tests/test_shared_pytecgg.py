from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from zgiis.live import pytecgg_service as service
from zgiis.processing.pytecgg_live import LivePytecgg


def test_networks_use_same_calibration_cycle_cutoff_and_navigation(monkeypatch):
    calls = []
    nav_data = object()
    ephemeris = object()

    class Engine:
        def calibrate(self, code, position, nav, *, cutoff, nav_data=None, ephemeris=None):
            calls.append((code, nav, cutoff, nav_data, ephemeris))
        def status(self, code):
            return {}

    monkeypatch.setattr(service, "_networks", {
        "zimbabwe": (Engine(), [{"code": "beit", "lat": -22.2, "lon": 30.0}]),
        "sansa": (Engine(), [{"code": "tdou", "lat": -23.08, "lon": 30.38}]),
    })
    monkeypatch.setattr(service, "_published", {})
    from zgiis.live import broadcast_ephemeris
    monkeypatch.setattr(broadcast_ephemeris, "_download_brdc", lambda *a, **k: Path("test-nav.rnx"))
    import pytecgg.parsing
    reads = []
    monkeypatch.setattr(pytecgg.parsing, "read_rinex_nav", lambda nav: reads.append(nav) or nav_data)
    preparations = []
    monkeypatch.setattr(service, "prepare_live_ephemeris",
                        lambda nav: preparations.append(nav) or ephemeris)

    def stop(_):
        raise SystemExit

    monkeypatch.setattr(service.time, "sleep", stop)
    with pytest.raises(SystemExit):
        service._worker()
    assert len(calls) == 2
    assert calls[0][1:] == calls[1][1:]
    assert reads == [Path("test-nav.rnx")]
    assert preparations == [nav_data]
    assert calls[0][3:] == calls[1][3:] == (nav_data, ephemeris)
    assert set(service._published) == {"zimbabwe", "sansa"}


def test_only_complete_shared_cycles_are_published_and_results_expire(monkeypatch):
    monkeypatch.delenv("VERCEL", raising=False)
    now = datetime.now(timezone.utc)
    engine = LivePytecgg()
    row = {"gg_vtec": 24.0, "gg_time": now.isoformat(), "gg_status": "ready"}
    engine._results["beit"] = row
    monkeypatch.setattr(service, "_networks", {"zimbabwe": (engine, [{"code": "beit"}])})
    monkeypatch.setattr(service, "_published", {})
    assert "gg_vtec" not in service.snapshot()["zimbabwe"]["beit"]
    service._published = {"zimbabwe": {"beit": row}}
    assert service.snapshot()["zimbabwe"]["beit"]["gg_vtec"] == 24
    engine._results["beit"] = {**row, "gg_time": (now - timedelta(minutes=11)).isoformat()}
    assert "gg_vtec" not in service.snapshot()["zimbabwe"]["beit"]


def test_same_stream_duration_rule_for_both_networks():
    assert service.calibration_session_seconds("60") == 600
    assert service.calibration_session_seconds("120") == 600
    assert service.calibration_session_seconds("900") == 900
    assert service.calibration_session_seconds("0") == 0


def test_expired_collector_snapshot_clears_both_gg_networks():
    from zgiis.cors.trignet_store import expire_snapshot
    payload = {"stations": [], "pytecgg_networks": {
        "zimbabwe": {"beit": {"gg_vtec": 25.0}}, "sansa": {"tdou": {"gg_vtec": 26.0}}}}
    assert expire_snapshot(payload, 0, now=181)["pytecgg_networks"] == {}
    assert "beit" in payload["pytecgg_networks"]["zimbabwe"]


def test_comparison_preserves_package_gg_without_gopi_clamping_or_neighbors():
    from backend.routers.live import _actual_pytecgg_summary
    from backend.schemas import LiveObservation
    now = datetime.now(timezone.utc).isoformat()
    gopi = [LiveObservation(time=now, station="beit", prn=f"G{i:02d}", vtec_tecu=25.0)
            for i in (1, 2, 3)]
    result = {"gg_vtec": 49.0, "gg_veq": 47.0, "gg_time": now, "gg_engine": "pytecgg",
              "gg_version": "1.3.0", "gg_status": "ready", "gg_samples": 3}
    _, rows, summary = _actual_pytecgg_summary(gopi, ["beit"], {"beit": result})
    assert rows[0].gg_latest == 49.0  # >15 TECU from G must not rewrite a package result
    assert rows[0].gg_veq == 47.0
    assert summary["gg_engine"] == "pytecgg"
    _, pending, _ = _actual_pytecgg_summary(gopi, ["beit"], {})
    assert pending[0].gg_latest is None  # no approximation or neighbour substitute
