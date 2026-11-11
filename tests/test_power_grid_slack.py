"""Power-grid Slack advisory uses supplied readings and never sample numbers."""

from datetime import datetime, timezone  # noqa: F401

from zgiis.space_weather.power_grid_slack import (
    classify_power_grid_level,
    format_power_grid_advisory,
)


def test_yellow_watch_uses_live_speed_not_a_sample():
    issued = datetime(2026, 11, 11, 11, 0, tzinfo=timezone.utc)
    text = format_power_grid_advisory(
        {
            "speed": 518,
            "bz": -2.89,
            "bt": 3.82,
            "density": 1.19,
            "kp": 0.0,
            "dst": -10,
            "bz_south_minutes": 114,
            "solar_time": "2026-11-11T09:20:00",
            "index_time": "2026-11-11T09:18:49Z",
        },
        issued_at=issued,
    )
    assert "518 km/s" in text
    assert "\u22122.9 nT" in text
    assert "Planetary Kp — 0" in text
    assert "\u221210 nT" in text
    assert "1.19 cm" in text
    assert "YELLOW" in text
    assert "580" not in text
    assert "illustrative" not in text.lower()
    assert "hypothetical" not in text.lower()
    assert "S4" not in text
    assert "13:00 CAT" in text
    assert "every 15 minutes" in text
    assert "06:00, 12:00, 18:00 and 00:00 CAT" in text


def test_quiet_readings_are_green():
    assert classify_power_grid_level(
        {"speed": 350, "bz": 1.2, "bt": 4, "density": 3, "kp": 2, "dst": -8}
    ) == "GREEN"


def test_kp_storm_is_orange_and_severe_kp_is_red():
    assert classify_power_grid_level({"kp": 5.3, "dst": -20, "speed": 400}) == "ORANGE"
    assert classify_power_grid_level({"kp": 7.1}) == "RED"


def test_threshold_alert_requires_a_sustained_crossing():
    from datetime import timezone

    from zgiis.space_weather.power_grid_slack import (
        active_power_grid_triggers,
        format_power_grid_threshold_alert,
    )

    quiet = {"speed": 518, "speed_high_minutes": 3, "bz": -2.0, "bz_watch_minutes": 0, "kp": 1, "dst": -8}
    assert active_power_grid_triggers(quiet) == []
    crossed = {
        "speed": 518,
        "speed_high_minutes": 20,
        "bz": -2.9,
        "bz_watch_minutes": 0,
        "bt": 3.8,
        "bt_high_minutes": 0,
        "density": 1.2,
        "density_high_minutes": 0,
        "kp": 0,
        "dst": -10,
        "solar_time": "2026-11-11T11:10:00Z",
        "index_time": "2026-11-11T11:10:00Z",
    }
    triggers = active_power_grid_triggers(crossed)
    assert [item["id"] for item in triggers] == ["solar_wind_speed"]
    text = format_power_grid_threshold_alert(
        crossed,
        triggers,
        alert_id="ZINGSA-GIC-20261111-001",
        issued_at=datetime(2026, 11, 11, 11, 15, tzinfo=timezone.utc),
    )
    assert "ZINGSA-GIC-20261111-001" in text
    assert "518 km/s" in text
    assert "Threshold reached" in text
    assert "580" not in text
    assert "hypothetical" not in text.lower()
    assert "13:15" in text
