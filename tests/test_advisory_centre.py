"""Advisory Centre classification tests — documented expected scientific outcomes."""
from zgiis.space_weather.advisory_centre import assess_advisory


def test_wind_over_500_without_storm_is_yellow_not_orange():
    result = assess_advisory(plasma_speed=620, kp=2.0, dst=-10, mean_vtec=25, s4=0.1, gnss_risk="low")
    assert result["advisory_level"] == "YELLOW"
    assert result["tracks"]["solar_watch"]["watch_active"] is True
    assert result["tracks"]["geomagnetic"]["observed_storm"] is False
    assert "not a geomagnetic storm" in " ".join(result["tracks"]["solar_watch"]["evidence"]).lower()


def test_fast_wind_northward_bz_no_storm():
    result = assess_advisory(plasma_speed=750, bz=4.0, kp=1.5, dst=-5, mean_vtec=20, s4=0.05)
    assert result["advisory_level"] == "YELLOW"
    assert result["tracks"]["geomagnetic"]["level"] == "GREEN"


def test_southward_bz_watch_without_confirmed_storm():
    result = assess_advisory(plasma_speed=420, bz=-8.0, kp=2.0, dst=-15)
    assert result["advisory_level"] == "YELLOW"
    assert result["tracks"]["geomagnetic"]["observed_storm"] is False


def test_kp5_is_orange_g1_not_severe():
    result = assess_advisory(kp=5.0, dst=-55, plasma_speed=480)
    assert result["advisory_level"] == "ORANGE"
    assert result["tracks"]["geomagnetic"]["g_scale"]["code"] == "G1"
    assert result["advisory_level"] != "RED"


def test_kp7_is_red_g3():
    result = assess_advisory(kp=7.0, dst=-120)
    assert result["advisory_level"] == "RED"
    assert result["tracks"]["geomagnetic"]["g_scale"]["code"] == "G3"


def test_local_gnss_disturbance_without_global_storm():
    result = assess_advisory(kp=2.0, dst=-10, s4=0.55, mean_vtec=45, gnss_risk="high")
    assert result["tracks"]["geomagnetic"]["observed_storm"] is False
    assert result["tracks"]["zimbabwe_gnss"]["level"] in {"ORANGE", "RED"}
    assert result["advisory_level"] in {"ORANGE", "RED"}
    assert "not by itself a global geomagnetic storm" in result["statement"]["body"].lower()


def test_global_storm_without_local_gnss_impact():
    result = assess_advisory(kp=5.3, dst=-60, mean_vtec=22, s4=0.08, gnss_risk="low")
    assert result["tracks"]["geomagnetic"]["observed_storm"] is True
    assert result["tracks"]["zimbabwe_gnss"]["confirmed_local_impact"] is False
    assert result["separation"]["global_geomagnetic_level"] == "ORANGE"
    assert result["separation"]["zimbabwe_gnss_level"] == "GREEN"


def test_missing_feeds_are_not_quiet():
    result = assess_advisory(
        solar_feed_available=False,
        geo_feed_available=False,
        local_feed_available=False,
    )
    text = " ".join(result["tracks"]["solar_watch"]["evidence"]).lower()
    assert "unavailable" in text
    assert result["confidence"]["label"] == "Limited"


def test_forecast_note_distinct_from_observation():
    result = assess_advisory(kp=2.0, forecast_note="NOAA forecast mentions possible G1 later; not observed now.")
    assert "forecast" in result["forecast_note"].lower()
    assert result["tracks"]["geomagnetic"]["observed_storm"] is False


def test_unapproved_publication_state_starts_draft():
    result = assess_advisory(kp=5.0)
    assert result["publication"]["state"] == "draft"
    assert result["publication"]["published_at"] is None


def test_aviation_disclaimer_always_present():
    result = assess_advisory(kp=1.0)
    aviation = next(s for s in result["stakeholders"] if s["id"] == "aviation")
    assert "does not replace approved aviation" in aviation["advice"].lower()


def test_statement_has_reference_and_cat_time():
    result = assess_advisory(plasma_speed=550, kp=2.0)
    assert result["advisory_id"].startswith("ZSWA-")
    assert "CAT" in result["issued_cat"]
    assert result["statement"]["title"] == "ZINGSA SPACE WEATHER ADVISORY"


def test_conditions_deescalate_from_orange_to_green():
    storm = assess_advisory(kp=5.0, dst=-55, plasma_speed=480)
    quiet = assess_advisory(kp=2.0, dst=-10, plasma_speed=380, bz=1.0, mean_vtec=22, s4=0.05, gnss_risk="low")
    assert storm["advisory_level"] == "ORANGE"
    assert quiet["advisory_level"] == "GREEN"
    assert quiet["tracks"]["geomagnetic"]["observed_storm"] is False


def test_forecast_does_not_override_observed_quiet():
    result = assess_advisory(
        kp=1.5,
        dst=-8,
        plasma_speed=390,
        forecast_note="Official three-day outlook mentions possible later disturbance; not observed now.",
    )
    assert result["advisory_level"] == "GREEN"
    assert "outlook" in (result.get("forecast_note") or "").lower()
    assert result["tracks"]["geomagnetic"]["observed_storm"] is False


def test_publication_starts_unpublished_even_when_red():
    result = assess_advisory(kp=8.0, dst=-180, s4=0.7, gnss_risk="high")
    assert result["advisory_level"] == "RED"
    assert result["publication"]["state"] == "draft"
    assert result["publication"].get("published_at") is None
