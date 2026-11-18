"""Selected IGS magnetic-equator stations using the shared CORS processing."""
import json
from pathlib import Path

from zgiis.cors import west_africa

SITES = json.loads((Path(__file__).resolve().parents[2] / "frontend/lib/magneticEquatorCorsCatalog.json").read_text())


def start() -> None:
    west_africa.start(sites=SITES)


def status(networks: dict) -> list[dict]:
    return west_africa.status(networks, sites=SITES)
