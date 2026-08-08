"""Tests for rover client snapshot parsing (no fabricated network calls)."""
from __future__ import annotations

from zgiis.live.rover_clients import parse_rover_clients_csv, parse_rover_clients_payload


def test_parse_json_ranks_busiest_first():
    snap = parse_rover_clients_payload(
        {
            "updated_at": "2026-08-08T01:00:00Z",
            "source": "test",
            "stations": [
                {"code": "beit", "mountpoint": "BEIT", "connected_rovers": 2},
                {"code": "hara", "mountpoint": "HARA", "connected_rovers": 11},
                {"code": "bula", "mountpoint": "BULA", "connected_rovers": 5},
            ],
        },
        source="test",
    )
    assert snap.available is True
    assert snap.total_rovers == 18
    assert snap.busiest_code == "hara"
    assert snap.busiest_count == 11
    assert snap.stations[0].code == "hara"
    assert snap.stations[0].rank == 1
    assert snap.stations[0].share_pct == 61.1


def test_parse_csv_clients_column():
    csv_text = "mountpoint,clients\nHARA,7\nMUTA,3\n"
    snap = parse_rover_clients_csv(csv_text, source="csv-test")
    assert snap.available is True
    assert snap.total_rovers == 10
    assert snap.stations_with_rovers == 2


def test_empty_payload_not_available():
    snap = parse_rover_clients_payload({"stations": []}, source="empty")
    assert snap.available is False
