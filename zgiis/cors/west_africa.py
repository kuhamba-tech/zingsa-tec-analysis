"""Independent Senegal/Centipede and Ghana/IGS observation pipelines."""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

SITES = json.loads((Path(__file__).resolve().parents[2] / "frontend/lib/westAfricaCorsCatalog.json").read_text())
_lock = threading.Lock()
_networks: dict[str, tuple] = {}


def configuration(site: dict) -> dict | None:
    if site["country"] == "SEN":
        return {"host": site["caster_host"], "port": site["caster_port"],
                "username": "centipede", "password": "centipede"}
    username = os.getenv("IGS_NTRIP_USERNAME", "").strip()
    password = os.getenv("IGS_NTRIP_PASSWORD", "")
    if not username or not password:
        return None
    return {"host": site["caster_host"], "port": site["caster_port"],
            "username": username, "password": password}


def start() -> None:
    if os.getenv("VERCEL"):
        return
    from zgiis.live.ntrip_stream import LiveNtripManager
    from zgiis.live.satellite_geometry import LiveNavCache
    from zgiis.live.stec_vtec import LiveVtecPipeline
    from zgiis.live.broadcast_ephemeris import start_refresh_thread
    from zgiis.live.pytecgg_service import register_network
    from zgiis.cors.trignet import _connect_live_archive

    with _lock:
        for site in SITES:
            name = site["network"]
            config = configuration(site)
            if name in _networks or config is None:
                continue
            nav = LiveNavCache()
            nav.set_receiver_location(site["code"], site["lat"], site["lon"], site["height"])
            engine = register_network(name, [site])
            pipeline = LiveVtecPipeline(nav_cache=nav, db_flush_n=5)
            def ingest(obs, engine=engine, pipeline=pipeline):
                engine.ingest(obs)
                pipeline.ingest(obs)
            manager = LiveNtripManager(config, on_observation=ingest, nav_cache=nav,
                                       max_concurrent=1, max_session_s=0)
            manager.start({site["code"].lower(): site["mountpoint"]})
            _networks[name] = manager, pipeline
            start_refresh_thread(nav)
            threading.Thread(target=_connect_live_archive, args=(pipeline,),
                             daemon=True, name=f"{name}-live-archive").start()


def status(networks: dict) -> list[dict]:
    rows = []
    with _lock:
        running = dict(_networks)
    for site in SITES:
        key, name = site["code"].lower(), site["network"]
        manager, pipeline = running.get(name, (None, None))
        link = manager.status().get(key, {}) if manager is not None else {}
        values = pipeline.latest_by_station(max_age_s=600) if pipeline is not None else {}
        diag = pipeline.diagnostics_by_station().get(key, {}) if pipeline is not None else {}
        gg = networks.get(name, {}).get(key, {})
        last = link.get("last_rtcm_at")
        rows.append({**site, "location_known": True,
            "connected": bool(link.get("connected")),
            "streaming": bool(last and (datetime.now(timezone.utc) - last).total_seconds() < 90),
            "stream_configured": manager is not None,
            "connection_status": "configured" if manager is not None else "igs_credentials_required",
            "message_count": link.get("rtcm_count", link.get("msg_count", 0)),
            "tec_diagnostics": diag, "vtec": values.get(key),
            "vtec_time": diag.get("last_code_vtec_at"), "samples": diag.get("vtec_emitted", 0),
            "gg_vtec": gg.get("gg_vtec"), "gg_time": gg.get("gg_time"),
            "gg_status": gg.get("gg_status", "awaiting_observations"),
            "gg_engine": "pytecgg", "gg_version": "1.3.0", "gg_samples": gg.get("gg_samples", 0),
        })
    return rows
