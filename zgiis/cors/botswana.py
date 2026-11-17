"""Botswana RTK2go observations, isolated from the SANSA caster account."""
from __future__ import annotations

import os
import threading
from datetime import datetime, timezone

SITES = [
    {"code": "GHANZIBW1", "name": "Ghanzi, Botswana", "mountpoint": "GHANZIBW1",
     "lat": -21.74000, "lon": 21.70000},
    {"code": "SurveyWorldBotswana", "name": "SurveyWorld Botswana",
     "mountpoint": "SurveyWorldBotswana", "lat": None, "lon": None},
]
_lock = threading.Lock()
_manager = None
_pipeline = None


def start() -> None:
    global _manager, _pipeline
    email = os.getenv("RTK2GO_NTRIP_EMAIL", "").strip()
    if os.getenv("VERCEL") or not email or "@" not in email:
        return
    with _lock:
        if _manager is not None:
            return
        from zgiis.live.ntrip_stream import LiveNtripManager
        from zgiis.live.satellite_geometry import LiveNavCache
        from zgiis.live.stec_vtec import LiveVtecPipeline
        from zgiis.live.broadcast_ephemeris import start_refresh_thread
        from zgiis.live.pytecgg_service import register_network
        from zgiis.cors.trignet import _connect_live_archive

        located = [site for site in SITES if site["lat"] is not None]
        nav = LiveNavCache()
        for site in located:
            nav.set_receiver_location(site["code"], site["lat"], site["lon"])
        engine = register_network("botswana", located)
        pipeline = LiveVtecPipeline(nav_cache=nav, db_flush_n=5)
        def ingest(obs):
            engine.ingest(obs)
            pipeline.ingest(obs)
        manager = LiveNtripManager(
            {"host": "rtk2go.com", "port": 2101, "username": email,
             "password": "none", "ntrip_version": "1"},
            on_observation=ingest, nav_cache=nav, max_concurrent=2, max_session_s=0,
        )
        manager.start({s["code"].lower(): s["mountpoint"] for s in SITES})
        _manager, _pipeline = manager, pipeline
        start_refresh_thread(nav)
        threading.Thread(target=_connect_live_archive, args=(pipeline,),
                         daemon=True, name="botswana-live-archive").start()


def status(networks: dict) -> list[dict]:
    """Keep unlocated stations visible in the list, never on the map at (0, 0)."""
    links = _manager.status() if _manager is not None else {}
    values = _pipeline.latest_by_station(max_age_s=600) if _pipeline is not None else {}
    diagnostics = _pipeline.diagnostics_by_station() if _pipeline is not None else {}
    rows = []
    for site in SITES:
        key = site["code"].lower()
        link, diag = links.get(key, {}), diagnostics.get(key, {})
        last = link.get("last_rtcm_at")
        gg = networks.get("botswana", {}).get(key, {})
        located = site["lat"] is not None
        rows.append({**site, "country": "BWA", "network": "botswana",
            "format": "RTCM", "constellations": [], "caster_host": "rtk2go.com",
            "caster_port": 2101, "ntrip_version": "1", "location_known": located,
            "connected": bool(link.get("connected")),
            "streaming": bool(last and (datetime.now(timezone.utc) - last).total_seconds() < 90),
            "stream_configured": key in links,
            "connection_status": "configured" if key in links else "email_required",
            "message_count": link.get("rtcm_count", link.get("msg_count", 0)),
            "vtec": values.get(key) if located else None,
            "vtec_time": diag.get("last_code_vtec_at") if located else None,
            "samples": diag.get("vtec_emitted", 0), "tec_diagnostics": diag,
            "gg_vtec": gg.get("gg_vtec") if located else None,
            "gg_time": gg.get("gg_time"), "gg_engine": "pytecgg", "gg_version": "1.3.0",
            "gg_status": gg.get("gg_status", "awaiting_observations") if located else "receiver_coordinates_required",
            "gg_samples": gg.get("gg_samples", 0),
        })
    return rows
