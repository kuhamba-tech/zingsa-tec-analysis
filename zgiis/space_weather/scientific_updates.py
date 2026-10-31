"""Official technical discussion, preserving summary/forecast and issue time."""
from datetime import datetime, timezone
import re
import threading
import time

URL = "https://services.swpc.noaa.gov/text/discussion.txt"
TOPICS = ("Solar Activity", "Energetic Particle", "Solar Wind", "Geospace")
_lock = threading.Lock()
_cached = None
_checked = 0.0


def parse_discussion(text, *, now=None):
    now = now or datetime.now(timezone.utc)
    issued = re.search(r"^:Issued:\s*(\d{4}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{4})\s+UTC\s*$", text, re.M)
    if not issued or "<html" in text.lower():
        raise ValueError("Unrecognised NOAA discussion")
    issue_time = datetime.strptime(" ".join(issued[1].split()), "%Y %b %d %H%M").replace(tzinfo=timezone.utc)
    age = (now-issue_time).total_seconds()
    if age < -300:
        raise ValueError("Discussion issue time is in the future")
    sections, topic, kind = {}, None, None
    for line in text.splitlines():
        value = line.strip()
        if value in TOPICS:
            topic, kind = value, None
            sections.setdefault(topic, {"observed":[], "forecast":[]})
        elif re.match(r"^\.24\s*hr\s+Summary", value, re.I):
            kind = "observed"
        elif re.match(r"^\.Forecast", value, re.I):
            kind = "forecast"
        elif topic and kind and value and not value.startswith(("#", ":")):
            sections[topic][kind].append(value)
    rows = [{"topic":name, "observed":" ".join(v["observed"]), "forecast":" ".join(v["forecast"])}
            for name,v in sections.items() if v["observed"] or v["forecast"]]
    if not rows:
        raise ValueError("Discussion sections are missing")
    missing = [topic for topic in TOPICS if topic not in {row["topic"] for row in rows}]
    return {"source":"NOAA SWPC Forecast Discussion", "source_url":URL,
        "issued_at":issue_time.isoformat().replace("+00:00","Z"),
        "checked_at":now.isoformat().replace("+00:00","Z"),
        "status":"stale" if age > 18*3600 or missing else "current",
        "sections":rows, "note":("Incomplete discussion; missing: " + ", ".join(missing) + ". " if missing else "")
            + "Official forecaster text. Issue time is not an individual instrument observation time."}


def get_scientific_updates():
    global _cached, _checked
    import requests
    with _lock:
        if _cached is not None and time.monotonic()-_checked < 180:
            result = dict(_cached)
        else:
            try:
                response = requests.get(URL, timeout=6, headers={"User-Agent":"ZGIIS scientific dashboard/1.0"})
                response.raise_for_status()
                result = parse_discussion(response.text[:200_000])
                _cached, _checked = result, time.monotonic()
            except (requests.RequestException, ValueError):
                result = {**(_cached or {}), "status":"stale" if _cached and _cached.get("sections") else "unavailable",
                    "source":"NOAA SWPC Forecast Discussion", "source_url":URL,
                    "note":"Refresh failed. Any retained discussion is historical guidance, not a current forecast."}
                _cached, _checked = result, time.monotonic()
        # A cached success must not remain 'current' indefinitely across failures.
        if result.get("issued_at") and result.get("status") == "current":
            age = (datetime.now(timezone.utc)-datetime.fromisoformat(result["issued_at"].replace("Z","+00:00"))).total_seconds()
            if age > 18*3600:
                result["status"] = "stale"
        return result
