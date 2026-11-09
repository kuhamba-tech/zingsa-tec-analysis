from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch
import csv
import io
import json
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI

from zgiis.gic.ingest import parse_gic_file
from zgiis.gic.quality import canonical_record
from zgiis.gic.operations import StationConfiguration, coverage, validate_ekf
from zgiis.gic.analysis import detect_events, build_report, report_to_csv
from zgiis.gic.climatology import climatology
from scripts.gic_gateway_upload import upload_file


def frame(currents, offsets=None):
    start = datetime.now(timezone.utc)-timedelta(hours=3)
    return pd.DataFrame({"time": [start+timedelta(seconds=v) for v in (offsets or [i*60 for i in range(len(currents))])],
                         "station_id": ["DEMA_001"]*len(currents), "gic_a": currents,
                         "quality_flags": [[] for _ in currents]})


def test_timezone_precision_flags_and_original_toa5_headers():
    data = b'"TOA5","DEMA","CR1000","123"\nTIMESTAMP,GIC_Avg,quality_flags\nTS,A,code\nSmp,Avg,Smp\n2026-01-01 02:00:00.123456,-12.123456,sensor_fault\n'
    rows = parse_gic_file(data, "field.dat", "DEMA_001", logger_timezone="Africa/Harare", calibration_id="certificate-1")
    assert rows[0]["time"] == "2026-01-01T00:00:00.123456+00:00"
    assert rows[0]["original_time"] == "2026-01-01 02:00:00.123456"
    assert rows[0]["gic_a"] == -12.123456
    assert rows[0]["quality_flags"] == ["sensor_fault"]
    assert rows[0]["toa5_headers"][0][2] == "CR1000"
    assert rows[0]["calibration_id"] == "certificate-1"


@pytest.mark.parametrize("current", ["nan", "inf", "-inf"])
def test_nonfinite_and_naive_currents_are_rejected(current):
    with pytest.raises(ValueError):
        canonical_record({"time": "2026-01-01T00:00:00Z", "gic_a": current, "station_id": "DEMA_001"})
    with pytest.raises(ValueError, match="timezone"):
        canonical_record({"time": "2026-01-01 00:00:00", "gic_a": 1, "station_id": "DEMA_001"})


def test_voltage_or_power_is_not_silently_labelled_current():
    with pytest.raises(ValueError, match="amperes"):
        parse_gic_file(b'TOA5,x\nTIMESTAMP,GIC_Avg\nTS,Watts\nSmp,Avg\n2026-01-01T00:00:00Z,1\n', 'wrong.dat', 'DEMA_001')


def test_backlog_oldest_first_replay_and_late_records(tmp_path):
    path = tmp_path / "logger.csv"
    path.write_text("TIMESTAMP,GIC_A\n"+"\n".join(f"2026-01-01T00:{i:02}:00Z,{i}" for i in range(7)))
    batches = []
    def post(url, json, **kwargs):
        batches.append(json["readings"])
        response = Mock()
        response.json.return_value = {"station_id": "DEMA_001", "received": len(json["readings"]), "inserted": len(json["readings"])}
        return response
    args = dict(path=path, station_id="DEMA_001", base_url="https://gateway.test", api_key="", state_file=tmp_path/"state", batch_size=2, post=post)
    result = upload_file(**args)
    assert result["received"] == 7
    assert [r["gic_a"] for batch in batches for r in batch] == list(range(7))
    assert upload_file(**args)["unchanged"]
    path.write_text(path.read_text()+"\n2026-01-01T00:00:30Z,-4\n")
    assert upload_file(**args)["received"] == 8  # No timestamp cursor drops a late record.


def test_failed_batch_does_not_advance_gateway_checkpoint(tmp_path):
    path=tmp_path/"logger.csv"
    path.write_text("TIMESTAMP,GIC_A\n2026-01-01T00:00:00Z,1\n2026-01-01T00:01:00Z,2\n")
    response=Mock(); response.json.return_value={"station_id":"DEMA_001", "received":1, "inserted":1}
    post=Mock(side_effect=[response, OSError("disconnected")])
    state=tmp_path/"state"
    with pytest.raises(OSError): upload_file(path=path,station_id="DEMA_001",base_url="https://gateway.test",api_key="",state_file=state,batch_size=1,post=post)
    assert not state.exists()


def test_coverage_and_events_exclude_faults_and_long_gaps():
    df=frame([11,12,40,-15], [0,60,3600,3660])
    config={"expected_cadence_seconds":60}
    events=detect_events(df,config)
    assert len(events)==2
    assert all(e["duration_min"]==1 for e in events)
    assert events[1]["peak_gic_a"]==40
    df.at[2,"quality_flags"]=["sensor_fault"]
    cov=coverage(df,df.time.iloc[0],df.time.iloc[0]+pd.Timedelta("2h"),60)
    assert cov["valid_records"]==3
    assert cov["missing_pct"]==97.5
    assert coverage(df,df.time.iloc[0],df.time.iloc[0]+pd.Timedelta("2h"),None)["missing_pct"] is None


def test_custom_thresholds_require_engineering_approval():
    with pytest.raises(ValueError): StationConfiguration(thresholds_a=[2,4,8,16])
    with pytest.raises(ValueError): StationConfiguration(thresholds_a=[5,5,25,35])
    with pytest.raises(ValueError): StationConfiguration(commissioned=True)
    approved=StationConfiguration(thresholds_a=[2,4,8,16],transformer_id="T1",engineer_approved_by="Engineer",engineer_approval_reference="ZETDC/approval",engineer_approved_at="2026-01-01T00:00:00Z")
    assert approved.thresholds_a==[2,4,8,16]


def test_validation_has_held_out_baselines_and_no_operational_warnings():
    df=frame([i*.1 for i in range(50)])
    result=validate_ekf(df,60)
    assert set(result["metrics"])=={"ekf","persistence","training_mean"}
    assert result["metrics"]["persistence"]["mae_a"]==pytest.approx(.1)
    assert result["metrics"]["persistence"]["bias_a"]==pytest.approx(-.1)
    assert result["training_period"]["end"] < result["test_period"]["start"]
    assert not result["operational_warnings_enabled"]
    df.at[25,"time"]+=pd.Timedelta("10s")
    assert validate_ekf(df,60)["metrics"] is None


def test_csv_preserves_polarity_and_quality_metadata():
    df=frame([-40,1]); df["metadata"]=[{"calibration_id":"a,b"},{}]; df["original_time"]=[str(t) for t in df.time]
    report=build_report(df,station_id="DEMA_001",period="daily",configuration={"expected_cadence_seconds":60})
    assert report["statistics"]["peak_abs_a"]==40
    assert report["coverage"]["expected_slots"]==1440
    rows=list(csv.reader(io.StringIO(report_to_csv(report,df))))
    assert any('-40' in row and '"a,b"' in ' '.join(row) for row in rows)
    assert any("No operational EKF prediction warnings" in note for note in report["interpretation"])


def test_climatology_storm_context_is_not_weather_causality():
    df=frame([1,12,3]); sw=pd.DataFrame({"time":[df.time.iloc[0]],"kp":[5]})
    result=climatology(df,sw,{},"daily")
    assert result["rows"][0]["geomagnetic_context"].startswith("Planetary storm")
    assert "do not imply weather causes GIC" in result["note"]
    with pytest.raises(ValueError): climatology(df,sw,{},"seasonal")


def test_admin_configuration_is_not_public(monkeypatch):
    from backend.routers.gic import router
    app=FastAPI();app.include_router(router)
    client=TestClient(app)
    monkeypatch.setenv("GIC_ADMIN_KEY","test-private-admin")
    response=client.put('/gic/configuration?station_id=DEMA_001',json={})
    assert response.status_code==403


def test_horizontal_vector_derivative_retains_rotating_field():
    from zgiis.gic.context import scientific_context
    df=frame([1,2]); df['metadata']=[{'bx_nt':100.,'by_nt':0.},{'bx_nt':0.,'by_nt':100.}]
    db=Mock(); db.query_dataframe.return_value=df
    db.station_config.return_value={'expected_cadence_seconds':60}
    db._conn.cursor.return_value.__enter__=Mock(return_value=Mock(fetchall=lambda: []))
    db._conn.cursor.return_value.__exit__=Mock(return_value=False)
    import threading
    db._lock=threading.RLock()
    with patch('zgiis.gic.context._noaa', return_value={'points':[],'fetch_failed':True}):
        result=scientific_context(db,pd.DataFrame(),'DEMA_001',24)
    sources={row['id']:row for row in result['sources']}
    assert sources['dhdt']['points'][0]['value']==0
    assert sources['dbdt_horizontal']['points'][0]['value']==pytest.approx(2**.5*100)
    assert sources['sym_h']['latest_observation'] is None


def test_network_topology_is_structurally_consistent_but_not_authoritatively_approved():
    from zgiis.gic.network import SUBSTATIONS, LINES
    codes={row['code'] for row in SUBSTATIONS}
    assert all(row['from'] in codes and row['to'] in codes for row in LINES)
    assert all(-23 <= row['lat'] <= -15 and 25 <= row['lon'] <= 34 for row in SUBSTATIONS)
