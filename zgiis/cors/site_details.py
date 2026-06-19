"""Vendor-style CORS site metadata for map detail panels (Leica GNSS Spider fields)."""
from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from zgiis.cors.stations import CorsStation

_SITE_META: dict[str, dict[str, str]] = {
    "muto": {"mountpoint": "MUTO", "marker_number": "MUTO", "marker_name": "MUTO"},
    "mata": {"mountpoint": "MATA", "marker_number": "MATA", "marker_name": "MATA"},
    "muta": {"mountpoint": "MUTA", "marker_number": "MUTA", "marker_name": "MUTA"},
    "bula": {"mountpoint": "BULA", "marker_number": "BULA", "marker_name": "BULA"},
    "gwer": {"mountpoint": "GWER", "marker_number": "GWER", "marker_name": "GWER"},
    "hacy": {"mountpoint": "HACY", "marker_number": "HACY", "marker_name": "HACY"},
    "masv": {"mountpoint": "MASV", "marker_number": "MASV", "marker_name": "MASV"},
    "hara": {"mountpoint": "HARA", "marker_number": "HARA", "marker_name": "HARA"},
    "zinh": {"mountpoint": "ZINH", "marker_number": "ZINHQ", "marker_name": "ZINGSA_HQ"},
    "lupa": {"mountpoint": "LUPA", "marker_number": "LUPA", "marker_name": "LUPA"},
    "cent": {"mountpoint": "CENT", "marker_number": "CENT", "marker_name": "CENT"},
    "karo": {"mountpoint": "KARO", "marker_number": "KARO", "marker_name": "KARO"},
    "kwek": {"mountpoint": "KWEK", "marker_number": "KWEK", "marker_name": "KWEK"},
    "gokw": {"mountpoint": "GOKW", "marker_number": "GOKW", "marker_name": "GOKW"},
    "gsu":  {"mountpoint": "GSU_", "marker_number": "GSU",  "marker_name": "GSU_"},
    "chir": {"mountpoint": "CHIR", "marker_number": "CHIR", "marker_name": "CHIR"},
    "chim": {"mountpoint": "CHIM", "marker_number": "CHIM", "marker_name": "CHIM"},
    "chiv": {"mountpoint": "CHIV", "marker_number": "CHIV", "marker_name": "CHIV"},
    "kari": {"mountpoint": "KARI", "marker_number": "KARI", "marker_name": "KARI"},
    "tsho": {"mountpoint": "TSHO", "marker_number": "TSHO", "marker_name": "TSHO"},
    "vicf": {"mountpoint": "VICF", "marker_number": "VICF", "marker_name": "VICF"},
    "gutu": {"mountpoint": "GUTU", "marker_number": "GUTU", "marker_name": "GUTU"},
    "beit": {"mountpoint": "BEIT", "marker_number": "BEIT", "marker_name": "BEIT"},
    "bing": {"mountpoint": "BING", "marker_number": "BING", "marker_name": "BING"},
}


def site_meta(code: str) -> dict[str, str]:
    key = code.lower().rstrip("_")
    base = _SITE_META.get(key, {})
    return {
        "mountpoint": base.get("mountpoint", code.upper()),
        "marker_name": base.get("marker_name", code.upper()),
        "marker_number": base.get("marker_number", code.upper()),
        "rtcm_id": "0000",
        "site_server": "Local Site Server",
    }


def vendor_status_label(status: str, *, connected: bool = False, receiving: bool = False) -> str:
    s = (status or "").lower()
    if s == "online" or receiving:
        return "Connected – receive data"
    if s == "degraded" or connected:
        return "Connected – no data"
    if s == "unknown":
        return "Status unknown"
    return "Disconnected"


def enrich_station_from_probe(
    station: CorsStation,
    probe_row: dict,
    *,
    probed_at: str | None = None,
) -> CorsStation:
    """Apply a one-shot NTRIP probe row (real caster decode) to site metadata."""
    from zgiis.live.ntrip_status_cache import verdict_map_status, verdict_site_label

    verdict = str(probe_row.get("verdict") or "offline")
    status = verdict_map_status(verdict)
    mountpoint = str(probe_row.get("mountpoint") or station.mountpoint or station.code.upper())
    last_update = (probed_at or "").replace("T", " ").replace("Z", " UTC")[:22]
    catalog = getattr(station, "catalog_status", "") or station.status

    meta = site_meta(station.code)
    return replace(
        station,
        status=status,
        status_source="ntrip",
        mountpoint=mountpoint,
        marker_name=meta["marker_name"],
        marker_number=meta["marker_number"],
        rtcm_id=meta["rtcm_id"],
        site_server="NTRIP Caster (live probe)",
        last_update=last_update,
        site_status_label=verdict_site_label(verdict),
        catalog_status=catalog,
        ntrip_verdict=verdict,
        ntrip_probed_at=probed_at or "",
    )


def enrich_station(station: CorsStation, *, stream: dict | None = None) -> CorsStation:
    meta = site_meta(station.code)
    mountpoint = meta["mountpoint"]
    last_update = ""
    connected = False
    receiving = False
    site_server = meta["site_server"]

    if stream:
        mountpoint = str(stream.get("mountpoint") or mountpoint)
        connected = bool(stream.get("connected"))
        msg_count = int(stream.get("msg_count") or 0)
        receiving = msg_count > 0 and stream.get("last_seen") is not None
        if stream.get("last_seen"):
            last_update = str(stream["last_seen"]).replace("T", " ").replace("+00:00", "")[:19]
        if receiving:
            site_server = "NTRIP Caster (live MSM)"

    label = vendor_status_label(
        station.status,
        connected=connected,
        receiving=receiving or station.status == "online",
    )

    return replace(
        station,
        mountpoint=mountpoint,
        marker_name=meta["marker_name"],
        marker_number=meta["marker_number"],
        rtcm_id=meta["rtcm_id"],
        site_server=site_server,
        last_update=last_update,
        site_status_label=label,
    )
