"""Plain-language drafts rendered only from the canonical assessment."""
from .advisory_assessment import LABELS, stamp
from .plain_news import news_time_lines, news_timestamp

PLATFORM = "https://zingsa-gnss-tec.vercel.app/"
AUDIENCES = {
    "citizen": ("Everyone", "🛰️", "Check your position against road signs. Stop safely before correcting a route."),
    "farmer": ("Farmers", "🌱", "Check guidance on a known line before planting or spraying. Pause auto-steer if the position jumps or corrections are lost."),
    "surveyor": ("Surveyors", "📐", "Check a known control point, RTK fix and correction age. Repeat the check; pause precise work if it fails."),
    "aviation": ("Aviation", "✈️", "Use official aviation space-weather advisories, NOTAMs and approved operator procedures. This public brief is not flight clearance."),
    "driver": ("Drivers", "🚗", "Compare the route with road signs. Stop safely before checking an unexpected GPS position."),
    "scientist": ("Scientists", "🔬", "Inspect station coverage, timestamps and quality flags. Do not treat code TEC or model proxies as measured positioning accuracy."),
}


def build_assessment_briefs(assessment):
    briefs = []
    for role, (title, icon, action) in AUDIENCES.items():
        sector = assessment["sectors"].get(role, assessment["sectors"]["citizen"])
        risk = sector["risk_level"]
        place = assessment["location"]
        headline = f"{place}: {LABELS[risk].lower()}"
        value = assessment["vtec"]
        reading = (f"Nearby station TEC is {value:.1f} TECU. TEC measures charged particles that can delay GPS signals."
                   if value is not None else "No fresh local TEC reading is available.")
        summary = f"{reading} {sector['can_continue']}"
        approved = [r["time_cat"] for r in assessment["working_windows"]
                    if r["basis"] == "validated_forecast" and r["risk_level"] == "favourable"]
        window = ", ".join(approved) if approved else "Pending: no validated suitable working window is available."
        impacts = {
            "surveyor":"Unstable signals can lengthen RTK start-up or cause loss of a fixed position.",
            "farmer":"Unstable positioning can shift planting or spraying lines. RTK-guided work needs stricter checks than ordinary navigation.",
            "citizen":"Unstable GPS can show the wrong position or route.",
        }.get(role,"Unstable satellite signals can affect positioning.")
        if risk == "insufficient_data":
            impacts += " Local effects are unconfirmed."
        script = "\n".join([
            f"ZINGSA Space Weather Advisory | {title} | {place}",
            *news_time_lines(stamp(assessment["observation_time"]), stamp(assessment["issued_at"])),
            headline, summary, f"Possible impact: {impacts}", f"What to do: {action}", f"Working window: {window}",
            f"Check again: {news_timestamp(stamp(assessment['next_update']))}",
            PLATFORM,
        ])
        sector_advisory = {**sector, "affected_sector":role, "potential_impacts":impacts,
                           "recommended_actions":[action], "working_window":window,
                           "assessment_id":assessment["assessment_id"]}
        briefs.append(dict(id=role, icon=icon, title=title, audience=title, headline=headline,
            summary=summary, space_weather_today=reading, space_weather_bullets=[],
            bullets=[f"Working window: {window}"], action=action,
            status_tone="excellent" if risk == "favourable" else "warning" if risk == "high_risk" else "moderate",
            broadcast_script=script, social_script=script, channels=["WhatsApp", "Facebook", "Web"],
            data_observed_at=assessment["observation_time"], brief_generated_at=assessment["issued_at"],
            data_checked_at=None, advisory=sector_advisory))
    return briefs


def build_national_briefs(assessments):
    """Summarise the reporting network without promoting one city to national truth."""
    import hashlib
    from .advisory_assessment import RANK
    if not assessments:
        return []
    observed = [a for a in assessments if a.get("observation_time") and a.get("vtec") is not None]
    times = sorted(a["observation_time"] for a in observed)
    missing = [a["location"] for a in assessments if a not in observed]
    readings = {}
    for a in observed:
        contributors = a.get("coverage", {}).get("contributors", [])
        code = contributors[0]["code"] if contributors else a["location_key"]
        readings.setdefault(code, a["vtec"])
    coverage = f"Fresh station readings near {len(observed)} of {len(assessments)} monitored areas."
    if readings:
        coverage += f" Reporting-station TEC range: {min(readings.values()):.1f}–{max(readings.values()):.1f} TECU across {len(readings)} distinct stations; not a national average."
    else:
        coverage += " No fresh station TEC readings are available."
    coverage += " Unmeasured places remain unverified."
    national = {**assessments[0], "location":"Zimbabwe", "location_key":"ZIMBABWE", "vtec":None,
        "observation_time":times[0] if times else None,
        "issued_at":max(a["issued_at"] for a in assessments),
        "next_update":min(a["next_update"] for a in assessments),
        "assessment_id":hashlib.sha256("|".join(a["assessment_id"] for a in assessments).encode()).hexdigest()[:20],
        "sectors":{}}
    for role in ("citizen","farmer","surveyor"):
        sectors=[a["sectors"][role] for a in assessments]
        risk=max((s["risk_level"] for s in sectors), key=lambda x:RANK[x])
        if risk=="favourable" and any(s["risk_level"]=="insufficient_data" for s in sectors):
            risk="insufficient_data"
        perf="degraded" if any(s["gnss_performance"]=="degraded" for s in sectors) else "not_verified" if any(s["gnss_performance"]=="not_verified" for s in sectors) else "verified"
        national["sectors"][role]={"risk_level":risk,"gnss_performance":perf,"confidence":None,
            "can_continue":"National coverage does not verify positioning at every work site. Use the regional evidence and check your equipment locally."}
    # A local model's favourable window must never become a countrywide window.
    national["working_windows"]=[]
    briefs=build_assessment_briefs(national)
    for brief in briefs:
        role=brief["id"] if brief["id"] in national["sectors"] else "citizen"
        affected=[a["location"] for a in assessments if a["sectors"][role]["risk_level"] in ("caution","high_risk")]
        summary=coverage + (f" Additional checks advised near: {', '.join(affected)}." if affected else " Local GNSS reliability is not established nationwide.")
        brief.update(headline="Zimbabwe: national GNSS update",summary=summary,space_weather_today=summary)
        brief["advisory"].update(scope="national",location="Zimbabwe",
            observation_window={"from":times[0] if times else None,"to":times[-1] if times else None},
            monitored_areas=len(assessments),areas_with_fresh_readings=len(observed),
            areas_without_fresh_readings=missing,
            regional_assessment_ids=[a["assessment_id"] for a in assessments])
        script="\n".join([f"ZINGSA Space Weather Advisory | {brief['title']} | Zimbabwe",
            *news_time_lines(stamp(national["observation_time"]),stamp(national["issued_at"])),
            "Zimbabwe: national GNSS update",summary,
            f"What to do: {brief['action']}",
            "Working window: no validated countrywide working window is available.",
            f"Check again: {news_timestamp(stamp(national['next_update']))}",PLATFORM])
        brief["broadcast_script"]=brief["social_script"]=script
    return briefs
