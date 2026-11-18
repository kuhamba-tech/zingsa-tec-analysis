from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from zgiis.gnss_prn.roti import summarize_station_roti


START = datetime(2026, 11, 18, tzinfo=timezone.utc)


def phase_row(prn: str, seconds: int, phase: float):
    return {"station": "gutu", "prn": prn, "time": START + timedelta(seconds=seconds), "tecp_tecu": phase}


def test_uses_population_std_of_phase_rates_and_station_median():
    rows = [
        phase_row(prn, step * 30, offset + amplitude * (step % 2))
        for prn, offset, amplitude in [("G01", 80, .5), ("G02", 300, 1.5)]
        for step in range(11)
    ]
    result = summarize_station_roti(pd.DataFrame(rows), START + timedelta(minutes=5))

    assert len(result) == 1
    assert result[0]["code"] == "gutu"
    assert result[0]["satellites"] == 2
    assert result[0]["roti"] == pytest.approx(2)


@pytest.mark.parametrize("interruption", ["gap", "phase_jump"])
def test_does_not_join_arcs_across_missing_samples_or_phase_jumps(interruption):
    rows = [
        phase_row("G01", step * 30, (step % 2) + (50 if step >= 6 and interruption == "phase_jump" else 0))
        for step in range(11)
        if step != 5 or interruption != "gap"
    ]
    assert summarize_station_roti(pd.DataFrame(rows), START + timedelta(minutes=5)) == []
