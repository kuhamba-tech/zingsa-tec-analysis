"""NOAA SWPC bulletin fields used on the Alerts page."""

from zgiis.space_weather.swpc_bulletins import parse_swpc_bulletin

WARK05 = """
Space Weather Message Code: WARK05
Serial Number: 2272
Issue Time: 2026 Oct 30 2311 UTC

WARNING: Geomagnetic K-index of 5 expected
Valid From: 2026 Oct 30 2310 UTC
Valid To: 2026 Oct 31 0600 UTC
Warning Conditions: Onset
Noaa Scale: G1 - Minor

NOAA Scale: G1 - Minor

Potential Impacts: Area of impact primarily poleward of 60 degrees Geomagnetic Latitude.
Induced Currents - Weak power grid fluctuations can occur.
"""

ALTEF3 = """
Space Weather Message Code: ALTEF3
Serial Number: 3762
Issue Time: 2026 Oct 30 1459 UTC

CONTINUED ALERT: Electron 2MeV Integral Flux exceeded 1,000pfu
Continuation of Serial Number: 3761
Begin Time: 2026 Oct 23 1140 UTC
"""

EXTENDED = """
Space Weather Message Code: WARK04
Serial Number: 5442
Issue Time: 2026 Oct 22 2021 UTC

EXTENDED WARNING: Geomagnetic K-index of 4 expected
Extension to Serial Number: 5441
Valid From: 2026 Oct 21 1616 UTC
Now Valid Until: 2026 Oct 23 0300 UTC
Warning Condition: Persistence
"""

WATA20 = """
Space Weather Message Code: WATA20
Serial Number: 1134
Issue Time: 2026 Oct 29 1910 UTC

WATCH: Geomagnetic Storm Category G1 Predicted
Highest Storm Level Predicted by Day:
Oct 30:  None (Below G1)   Oct 31:  G1 (Minor)   Nov 01:  G1 (Minor)
"""

SUM10R = """
Space Weather Message Code: SUM10R
Serial Number: 930
Issue Time: 2026 Oct 19 0909 UTC

SUMMARY: 10cm Radio Burst
Begin Time: 2026 Oct 19 0858 UTC
Peak Flux: 430 sfu
Duration: 1 minutes
"""


def test_k5_warning_carries_scale_and_validity():
    parsed = parse_swpc_bulletin(WARK05)
    assert parsed["code"] == "WARK05"
    assert parsed["serial"] == "2272"
    assert parsed["kind"] == "WARNING"
    assert parsed["valid_from"] == "2026 Oct 30 2310 UTC"
    assert parsed["valid_to"] == "2026 Oct 31 0600 UTC"
    assert parsed["noaa_scale"] == "G1 - Minor"
    assert parsed["condition"] == "Onset"
    assert "poleward of 60" in parsed["impacts"]


def test_continued_electron_alert_keeps_the_prior_serial():
    parsed = parse_swpc_bulletin(ALTEF3)
    assert parsed["code"] == "ALTEF3"
    assert parsed["kind"] == "CONTINUED ALERT"
    assert parsed["continuation_of"] == "3761"
    assert "1,000pfu" in parsed["headline"]


def test_extended_warning_uses_the_new_end_time():
    parsed = parse_swpc_bulletin(EXTENDED)
    assert parsed["kind"] == "EXTENDED WARNING"
    assert parsed["extension_to"] == "5441"
    assert parsed["valid_to"] == "2026 Oct 23 0300 UTC"
    assert parsed["condition"] == "Persistence"


def test_cancel_watch_keeps_its_kind():
    parsed = parse_swpc_bulletin(
        "Space Weather Message Code: WATA30\n"
        "Serial Number: 286\n"
        "Issue Time: 2026 Oct 11 1702 UTC\n\n"
        "CANCEL WATCH: Geomagnetic Storm Category G2 Predicted\n"
        "Cancel Serial Number: 285\n"
    )
    assert parsed["kind"] == "CANCEL WATCH"
    assert parsed["code"] == "WATA30"
    assert "G2" in parsed["headline"]


def test_watch_and_radio_summary_have_headlines():
    watch = parse_swpc_bulletin(WATA20)
    radio = parse_swpc_bulletin(SUM10R)
    assert watch["kind"] == "WATCH"
    assert "G1" in watch["headline"]
    assert radio["kind"] == "SUMMARY"
    assert radio["code"] == "SUM10R"
