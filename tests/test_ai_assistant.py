"""Tests for AI assistant context assembly."""

from __future__ import annotations

from unittest.mock import MagicMock

import pandas as pd

from zgiis.ai.context import (
    MAX_CHAT_MESSAGES,
    build_context_block,
    fetch_tec_summary,
    trim_messages,
)


def test_trim_messages_keeps_tail():
    msgs = [{"role": "user", "content": f"m{i}"} for i in range(30)]
    trimmed = trim_messages(msgs)
    assert len(trimmed) == MAX_CHAT_MESSAGES
    assert trimmed[0]["content"] == f"m{30 - MAX_CHAT_MESSAGES}"


def test_build_context_block_handles_missing_numeric_values():
    text, lines, structured = build_context_block(
        tec_summary={"scope": "station", "station": "hara", "hours": 2},
        sw={"kp": None, "kp_condition": "Quiet", "gnss_risk": "Low"},
    )
    assert "N/A" in text
    assert len(lines) >= 2
    assert structured["tec"]["station"] == "hara"


def test_build_context_block_includes_ekf_and_live():
    _, lines, structured = build_context_block(
        ekf_summary={"recent_count": 2, "unacknowledged_count": 1, "latest_parameter": "S4", "latest_severity": "Moderate"},
        live_summary={"ingest_enabled": True, "active_streams": 3, "db_backend": "sqlite"},
    )
    assert any("EKF alerts" in line for line in lines)
    assert any("Live NTRIP" in line for line in lines)
    assert structured["ekf_alerts"]["recent_count"] == 2


def test_fetch_tec_summary_station_scope():
    db = MagicMock()
    db.query_recent.return_value = pd.DataFrame(
        {"station": ["hara", "hara"], "vtec_tecu": [12.0, 14.0]}
    )
    summary = fetch_tec_summary(db, station="hara", hours=2.0)
    assert summary is not None
    assert summary["scope"] == "station"
    assert summary["latest_vtec"] == 14.0
    assert summary["samples"] == 2


def test_fetch_tec_summary_network_fallback():
    db = MagicMock()
    db.query_recent.return_value = pd.DataFrame()
    db.station_summary.return_value = pd.DataFrame(
        {"station": ["hara", "karoi"], "mean_vtec": [10.0, 12.0], "max_vtec": [15.0, 18.0], "obs_count": [5, 7]}
    )
    summary = fetch_tec_summary(db, hours=2.0)
    assert summary is not None
    assert summary["scope"] == "network"
    assert summary["stations_reporting"] == 2
