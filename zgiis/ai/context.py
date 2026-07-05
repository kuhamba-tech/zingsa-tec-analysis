"""Live ZGIIS context assembly for the AI assistant."""

from __future__ import annotations

from typing import Any, Optional

MAX_CHAT_MESSAGES = 24


def trim_messages(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    """Keep the most recent turns to control token use."""
    if len(messages) <= MAX_CHAT_MESSAGES:
        return messages
    return messages[-MAX_CHAT_MESSAGES:]


def _fmt(value: Any, *, unit: str = "", digits: int = 1) -> str:
    if value is None:
        return "N/A"
    try:
        return f"{float(value):.{digits}f}{unit}"
    except (TypeError, ValueError):
        return f"{value}{unit}"


def fetch_tec_summary(db, station: str | None = None, hours: float = 2.0) -> dict[str, Any] | None:
    """Summarise recent VTEC from TecDB for one station or the whole network."""
    if db is None:
        return None
    try:
        station_key = station.lower().strip() if station else None
        df = db.query_recent(hours=hours, station=station_key)
        value_col = "vtec_tecu" if not df.empty and "vtec_tecu" in df.columns else "vtec"

        if df.empty and station_key:
            return None

        if df.empty:
            summary = db.station_summary(hours=hours)
            if summary.empty:
                return None
            return {
                "scope": "network",
                "stations_reporting": int(len(summary)),
                "mean_vtec": float(summary["mean_vtec"].mean()),
                "max_vtec": float(summary["max_vtec"].max()),
                "samples": int(summary["obs_count"].sum()),
                "hours": hours,
            }

        return {
            "scope": "station",
            "station": station_key or str(df["station"].iloc[-1]),
            "mean_vtec": float(df[value_col].mean()),
            "max_vtec": float(df[value_col].max()),
            "latest_vtec": float(df[value_col].iloc[-1]),
            "samples": int(len(df)),
            "hours": hours,
        }
    except Exception:
        return None


def fetch_ekf_summary(hours: float = 6.0) -> dict[str, Any] | None:
    """Recent EKF deviation alerts for cross-check context."""
    try:
        from zgiis.db.ekf_alert_db import EkfAlertDB

        alerts = EkfAlertDB().list_alerts(hours=hours)
        if not alerts:
            return None
        unacked = [a for a in alerts if not a.get("acknowledged_status")]
        latest = alerts[0]
        return {
            "recent_count": len(alerts),
            "unacknowledged_count": len(unacked),
            "latest_severity": latest.get("severity"),
            "latest_parameter": latest.get("parameter_label") or latest.get("parameter"),
            "latest_message": latest.get("alert_message"),
        }
    except Exception:
        return None


def build_context_block(
    tec_summary: Optional[dict] = None,
    sw: Optional[dict] = None,
    ekf_summary: Optional[dict] = None,
    live_summary: Optional[dict] = None,
) -> tuple[str, list[str], dict[str, Any]]:
    """Build system-prompt context text and a structured summary for the UI."""
    lines: list[str] = []
    structured: dict[str, Any] = {}

    if tec_summary:
        structured["tec"] = tec_summary
        if tec_summary.get("scope") == "network":
            lines.append(
                f"[TEC network (last {tec_summary.get('hours', 2):g} h) — "
                f"{tec_summary.get('stations_reporting', 'N/A')} stations reporting, "
                f"mean VTEC: {_fmt(tec_summary.get('mean_vtec'), unit=' TECU')}, "
                f"max VTEC: {_fmt(tec_summary.get('max_vtec'), unit=' TECU')}, "
                f"samples: {tec_summary.get('samples', 'N/A')}]"
            )
        else:
            lines.append(
                f"[TEC station {tec_summary.get('station', 'N/A')} (last {tec_summary.get('hours', 2):g} h) — "
                f"latest VTEC: {_fmt(tec_summary.get('latest_vtec'), unit=' TECU')}, "
                f"mean: {_fmt(tec_summary.get('mean_vtec'), unit=' TECU')}, "
                f"max: {_fmt(tec_summary.get('max_vtec'), unit=' TECU')}, "
                f"samples: {tec_summary.get('samples', 'N/A')}]"
            )

    if sw:
        structured["space_weather"] = {
            "kp": sw.get("kp"),
            "kp_condition": sw.get("kp_condition"),
            "f107": sw.get("f107"),
            "dst": sw.get("dst"),
            "solar_wind_speed": sw.get("solar_wind_speed"),
            "s4": sw.get("s4"),
            "gnss_risk": sw.get("gnss_risk"),
            "stations_online": sw.get("stations_online"),
            "stations_total": sw.get("stations_total"),
        }
        lines.append(
            f"[Space weather — Kp: {_fmt(sw.get('kp'), digits=1)}, "
            f"condition: {sw.get('kp_condition', 'N/A')}, "
            f"Dst: {_fmt(sw.get('dst'), unit=' nT', digits=0)}, "
            f"solar wind: {_fmt(sw.get('solar_wind_speed'), unit=' km/s', digits=0)}, "
            f"F10.7: {_fmt(sw.get('f107'), unit=' sfu')}, "
            f"S4: {_fmt(sw.get('s4'), digits=2)}, "
            f"GNSS risk: {sw.get('gnss_risk', 'N/A')}]"
        )
        if sw.get("stations_online") is not None:
            lines.append(
                f"[CORS network — {sw.get('stations_online', 'N/A')}/"
                f"{sw.get('stations_total', 'N/A')} stations online]"
            )

    if ekf_summary:
        structured["ekf_alerts"] = ekf_summary
        lines.append(
            f"[EKF alerts (last 6 h) — {ekf_summary.get('recent_count', 0)} logged, "
            f"{ekf_summary.get('unacknowledged_count', 0)} unacknowledged; "
            f"latest: {ekf_summary.get('latest_parameter', 'N/A')} "
            f"({ekf_summary.get('latest_severity', 'N/A')})]"
        )

    if live_summary:
        structured["live_pipeline"] = live_summary
        lines.append(
            f"[Live NTRIP pipeline — ingest {'on' if live_summary.get('ingest_enabled') else 'off'}, "
            f"{live_summary.get('active_streams', 0)} active streams, "
            f"storage: {live_summary.get('db_backend', 'N/A')}]"
        )

    return "\n".join(lines), lines, structured
