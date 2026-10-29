"""Decoder tests for Spider rover-status frames. No network calls."""
from __future__ import annotations

import struct

from zgiis.live.spider_rover_clients import connected_rovers_from_cache, parse_event


def _string(value: str) -> bytes:
    return value.encode("utf-8") + b"\x00"


def _rover_update(station: str) -> bytes:
    body = bytearray()
    body.append(9)
    body += struct.pack("<d", 1_700_000_000_000.0)
    body += bytes(16)
    body += struct.pack("<I", 0)
    body += _string("net")
    body += _string("rtk")
    body += struct.pack("<I", 1)
    body += struct.pack("<i", 2)
    body += _string("user")
    body += struct.pack("<i", 3)
    body += _string("user")
    body += struct.pack("<b", 0)
    body += bytes([8, 7])
    body += struct.pack("<f", 0.2)
    body += _string(station)
    body += struct.pack("<f", 1.1)
    body += struct.pack("<ddd", 31.0, -17.7, 1500.0)
    body += struct.pack("<f", 12.0)
    body += bytes([3])
    body += struct.pack("<iii", 10, 0, 10)
    body += _string("")
    body += struct.pack("<d", 1_700_000_000_000.0)
    body += _string("RTK")
    body += bytes([1])
    body += _string("10.0.0.8")
    body += _string("NTRIP")
    body += struct.pack("<d", 0.0)
    body += struct.pack("<i", 1)
    body += struct.pack("<i", 0)
    return bytes(body)


def test_rover_cache_counts_one_connection_per_job():
    update = _rover_update("ZINH")
    cache = bytearray()
    cache.append(4)
    cache += struct.pack("<d", 1_700_000_000_000.0)
    cache += struct.pack("<H", 1)
    cache += update
    event, end = parse_event(bytes(cache), 0)
    assert end == len(cache)
    rovers = connected_rovers_from_cache(event)
    assert len(rovers) == 1
    assert rovers[0]["reference_station_name"] == "ZINH"
