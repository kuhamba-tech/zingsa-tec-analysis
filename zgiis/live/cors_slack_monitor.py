"""Post CORS station health changes to the CORS management Slack channel.

Runs inside the live NTRIP collector only (the collector lock guarantees a
single alerter). Leica Spider Site Status is the source of truth. NTRIP
fallback rows are never used for station up/down, because the caster allows
one connection at a time and most stations always look idle through NTRIP.

Events posted to ``SLACK_CORS_WEBHOOK_URL``:

* station went offline / came back online (debounced, with downtime)
* several stations dropping together (one grouped message)
* a station flapping between online and offline
* Spider Site Status unreachable or stale, and restored
* the caster refusing the NTRIP account while no data arrives, and recovered
* live TEC not reaching the database, and resumed
* monitor started for the first time, or resumed after a long gap
* a daily network summary

State lives in a JSON file under ``static/data`` (a Docker volume on the VPS),
so a container restart does not repeat alerts already posted.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger(__name__)

CAT = timezone(timedelta(hours=2), "CAT")
_DASHBOARD = "https://zingsa-gnss-tec.vercel.app/"


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def cors_webhook_url() -> str:
    return os.getenv("SLACK_CORS_WEBHOOK_URL", "").strip()


def cors_slack_configured() -> bool:
    url = cors_webhook_url()
    return url.startswith("https://") and " " not in url


def _cors_dry_run() -> bool:
    raw = os.getenv("CORS_ALERT_DRY_RUN")
    if raw is None or not raw.strip():
        raw = os.getenv("STORM_ALERT_DRY_RUN", "true")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def post_cors_slack(text: str) -> tuple[bool, str]:
    """Send one message to the CORS channel. Never falls back to the storm webhook."""
    if not cors_slack_configured():
        return False, "SLACK_CORS_WEBHOOK_URL not set"
    from zgiis.space_weather.slack_alerts import post_slack_to

    return post_slack_to(cors_webhook_url(), text, dry_run=_cors_dry_run())


def _fmt_time(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, tz=CAT).strftime("%d %b %Y %H:%M CAT")


def _fmt_duration(seconds: float) -> str:
    seconds = max(0, int(seconds))
    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    if days:
        return f"{days}d {hours}h"
    if hours:
        return f"{hours}h {minutes}m"
    return f"{max(minutes, 1)}m"


def _parse_fetched_at(value: Any) -> float | None:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def _station_names() -> dict[str, str]:
    try:
        from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

        return {s.code.lower().rstrip("_"): s.name for s in ZIMBABWE_CORS_STATIONS}
    except Exception:
        return {}


def spider_statuses(payload: dict[str, Any]) -> dict[str, str]:
    """online/offline per Spider site. Unknown Spider codes are left out."""
    out: dict[str, str] = {}
    for code, row in (payload.get("by_station") or {}).items():
        if not isinstance(row, dict):
            continue
        try:
            raw = int(row.get("spider_status"))
        except (TypeError, ValueError):
            raw = -1
        if raw < 0:
            continue
        status = str(row.get("status") or "").lower()
        if status in {"online", "offline"}:
            out[str(code).lower().rstrip("_")] = status
    return out


class CorsSlackMonitor:
    def __init__(
        self,
        state_path: Path,
        *,
        now: Callable[[], float] = time.time,
        names: dict[str, str] | None = None,
    ) -> None:
        self.state_path = Path(state_path)
        self.now = now
        self.names = names if names is not None else _station_names()
        self.confirm_checks = max(1, _env_int("CORS_ALERT_CONFIRM_CHECKS", 3))
        self.spider_stale_s = _env_float("CORS_SPIDER_STALE_SECONDS", 300)
        self.spider_alert_s = _env_float("CORS_SPIDER_ALERT_SECONDS", 600)
        self.mass_outage_n = max(2, _env_int("CORS_MASS_OUTAGE_MIN", 4))
        self.flap_n = max(3, _env_int("CORS_FLAP_TRANSITIONS", 4))
        self.flap_window_s = _env_float("CORS_FLAP_WINDOW_SECONDS", 7200)
        self.flap_quiet_s = _env_float("CORS_FLAP_QUIET_SECONDS", 3600)
        self.no_data_alert_s = _env_float("CORS_NO_DATA_ALERT_SECONDS", 600)
        self.tec_alert_s = _env_float("CORS_TEC_STALE_ALERT_SECONDS", 900)
        self.startup_grace_s = _env_float("CORS_STARTUP_GRACE_SECONDS", 600)
        self.resume_gap_s = _env_float("CORS_RESUME_GAP_SECONDS", 900)
        hour = os.getenv("CORS_DAILY_SUMMARY_HOUR", "8").strip()
        self.summary_hour = int(hour) if hour.isdigit() and int(hour) < 24 else None
        self.started_at = self.now()
        self.state = self._load()

    # ---------- persistence ----------
    def _load(self) -> dict[str, Any]:
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("stations"), dict):
                return data
        except FileNotFoundError:
            pass
        except Exception as exc:
            log.warning("CORS alert state unreadable, starting fresh: %s", exc)
        return {}

    def _save(self) -> None:
        try:
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.state_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.state, indent=1, sort_keys=True), encoding="utf-8")
            os.replace(tmp, self.state_path)
        except Exception as exc:
            log.warning("CORS alert state not saved: %s", exc)

    def _label(self, code: str) -> str:
        name = self.names.get(code)
        return f"*{code.upper()}* ({name})" if name else f"*{code.upper()}*"

    # ---------- main entry ----------
    def evaluate(
        self,
        spider_payload: dict[str, Any] | None,
        *,
        tec_age_s: float | None = None,
        tec_checked: bool = False,
        last_data_at: float | None = None,
        last_reject_at: float | None = None,
    ) -> list[str]:
        """Update state from one heartbeat and return Slack messages to post."""
        now = self.now()
        messages: list[str] = []
        payload = spider_payload or {}
        fetched = _parse_fetched_at(payload.get("fetched_at"))
        statuses = spider_statuses(payload)
        spider_fresh = bool(statuses) and fetched is not None and now - fetched <= self.spider_stale_s

        first_run = not self.state
        if first_run:
            if not spider_fresh:
                return []  # wait for a real Spider reading before seeding
            self.state = {"stations": {}, "spider": {}, "caster": {}, "tec": {}, "flapping": {}}
            for code, status in statuses.items():
                self.state["stations"][code] = {"status": status, "since": now, "transitions": []}
            self.state["last_heartbeat"] = now
            self.state["last_summary_date"] = datetime.fromtimestamp(now, tz=CAT).date().isoformat()
            messages.append(self._network_message("CORS monitoring started", statuses, now))
            self._save()
            return messages

        gap = now - float(self.state.get("last_heartbeat") or now)
        if gap > self.resume_gap_s:
            messages.append(
                f":arrows_counterclockwise: *CORS monitoring resumed* after {_fmt_duration(gap)} without checks. "
                "Station changes during that time are reported below once confirmed."
            )
        self.state["last_heartbeat"] = now

        messages.extend(self._check_spider(spider_fresh, fetched, payload.get("error"), now))
        if spider_fresh:
            messages.extend(self._check_stations(statuses, now))
        messages.extend(self._check_caster(last_data_at, last_reject_at, now))
        if tec_checked:
            messages.extend(self._check_tec(tec_age_s, now))
        if spider_fresh:
            summary = self._maybe_daily_summary(now)
            if summary:
                messages.append(summary)
        self._save()
        return messages

    # ---------- checks ----------
    def _check_spider(self, fresh: bool, fetched: float | None, error: Any, now: float) -> list[str]:
        sp = self.state.setdefault("spider", {})
        if fresh:
            if sp.get("alerted"):
                down_for = now - float(sp.get("stale_since") or now)
                sp.clear()
                return [
                    ":white_check_mark: *Spider Site Status restored.* Station monitoring is running again "
                    f"after {_fmt_duration(down_for)}."
                ]
            sp.clear()
            return []
        if not sp.get("stale_since"):
            sp["stale_since"] = fetched if fetched else now
        stale_for = now - float(sp["stale_since"])
        if not sp.get("alerted") and stale_for >= self.spider_alert_s:
            sp["alerted"] = True
            detail = f"\nLast error: {str(error)[:200]}" if error else ""
            last = f"Last good reading: {_fmt_time(fetched)}." if fetched else "No good reading yet."
            return [
                ":warning: *Spider Site Status unreachable.* CORS station up/down alerts are paused "
                f"until it answers again. {last}{detail}"
            ]
        return []

    def _check_stations(self, statuses: dict[str, str], now: float) -> list[str]:
        stations = self.state.setdefault("stations", {})
        flapping = self.state.setdefault("flapping", {})
        went_down: list[tuple[str, dict]] = []
        came_up: list[tuple[str, float]] = []
        flap_msgs: list[str] = []

        for code, status in statuses.items():
            rec = stations.get(code)
            if rec is None:
                stations[code] = {"status": status, "since": now, "transitions": []}
                continue
            if status == rec.get("status"):
                rec.pop("pending", None)
                rec.pop("pending_count", None)
                rec.pop("pending_since", None)
                continue
            if rec.get("pending") != status:
                rec["pending"] = status
                rec["pending_count"] = 1
                rec["pending_since"] = now
            else:
                rec["pending_count"] = int(rec.get("pending_count") or 0) + 1
            if rec["pending_count"] < self.confirm_checks:
                continue
            # Confirmed change. Date it from the first reading that showed it.
            changed_at = float(rec.get("pending_since") or now)
            previous_since = float(rec.get("since") or changed_at)
            rec["status"] = status
            rec["since"] = changed_at
            for key in ("pending", "pending_count", "pending_since"):
                rec.pop(key, None)
            transitions = [t for t in rec.get("transitions", []) if now - t <= self.flap_window_s]
            transitions.append(changed_at)
            rec["transitions"] = transitions

            if code in flapping:
                continue
            if len(transitions) >= self.flap_n:
                flapping[code] = now
                flap_msgs.append(
                    f":repeat: {self._label(code)} is *unstable*: {len(transitions)} online/offline changes "
                    f"in the last {_fmt_duration(self.flap_window_s)}. Individual alerts for it are paused "
                    f"until it holds one state for {_fmt_duration(self.flap_quiet_s)}. Now: {status}."
                )
                continue
            if status == "offline":
                went_down.append((code, rec))
            else:
                came_up.append((code, changed_at - previous_since))

        # Flapping stations that have settled.
        for code in list(flapping):
            rec = stations.get(code) or {}
            if rec.get("pending"):
                continue
            if now - float(rec.get("since") or now) >= self.flap_quiet_s:
                del flapping[code]
                flap_msgs.append(
                    f":white_check_mark: {self._label(code)} has settled: *{rec.get('status', 'unknown')}* "
                    f"for {_fmt_duration(now - float(rec.get('since') or now))}. Normal alerts resume."
                )

        messages: list[str] = []
        total = len(statuses)
        online = sum(1 for s in statuses.values() if s == "online")
        tally = f"Network: {online}/{total} Spider stations online."
        if went_down:
            lines = [f"• {self._label(code)} offline since {_fmt_time(float(rec['since']))}" for code, rec in went_down]
            if len(went_down) >= self.mass_outage_n:
                head = (
                    f":rotating_light: *{len(went_down)} CORS stations went offline together.* "
                    "This usually points to a shared cause: power, the comms provider, or the Spider server, "
                    "rather than the individual receivers."
                )
            elif len(went_down) == 1:
                head = ":red_circle: *CORS station offline*"
            else:
                head = f":red_circle: *{len(went_down)} CORS stations offline*"
            messages.append("\n".join([head, *lines, tally, _DASHBOARD + "cors"]))
        if came_up:
            lines = [f"• {self._label(code)} back online after {_fmt_duration(down)} offline" for code, down in came_up]
            head = ":large_green_circle: *CORS station back online*" if len(came_up) == 1 else (
                f":large_green_circle: *{len(came_up)} CORS stations back online*"
            )
            messages.append("\n".join([head, *lines, tally]))
        messages.extend(flap_msgs)
        return messages

    def _check_caster(self, last_data_at: float | None, last_reject_at: float | None, now: float) -> list[str]:
        cs = self.state.setdefault("caster", {})
        if now - self.started_at < self.startup_grace_s:
            return []
        reference = last_data_at if last_data_at else self.started_at
        quiet_for = now - reference
        rejecting = last_reject_at is not None and now - last_reject_at <= 180
        if not cs.get("alerted"):
            if quiet_for >= self.no_data_alert_s and rejecting:
                cs["alerted"] = True
                cs["since"] = reference
                return [
                    ":no_entry: *NTRIP caster is refusing the collector.* No station has delivered data for "
                    f"{_fmt_duration(quiet_for)} and the caster keeps answering \"account access or connection limit\". "
                    "The account allows one connection at a time, so another collector, a surveying rover or a "
                    "test client is probably logged in with it. Live TEC is not being collected."
                ]
            return []
        if last_data_at and now - last_data_at <= 120:
            down_for = last_data_at - float(cs.get("since") or last_data_at)
            cs.clear()
            return [
                ":white_check_mark: *NTRIP caster accepting the collector again.* Live data is flowing "
                f"(interrupted for {_fmt_duration(down_for)})."
            ]
        return []

    def _check_tec(self, age_s: float | None, now: float) -> list[str]:
        ts = self.state.setdefault("tec", {})
        if now - self.started_at < self.startup_grace_s:
            return []
        stale = age_s is None or age_s > self.tec_alert_s
        if stale and not ts.get("alerted"):
            ts["alerted"] = True
            ts["since"] = now - (age_s if age_s is not None else self.tec_alert_s)
            age_text = "over 6 hours" if age_s is None else _fmt_duration(age_s)
            return [
                ":hourglass: *Live TEC is not reaching the database.* The newest live observation is "
                f"{age_text} old. The dashboard's live VTEC will look frozen until it resumes."
            ]
        if ts.get("alerted") and age_s is not None and age_s <= 180:
            gap = now - float(ts.get("since") or now)
            ts.clear()
            return [f":white_check_mark: *Live TEC is reaching the database again* (gap of about {_fmt_duration(gap)})."]
        return []

    # ---------- summaries ----------
    def _network_message(self, title: str, statuses: dict[str, str], now: float) -> str:
        online = sorted(c for c, s in statuses.items() if s == "online")
        offline = sorted(c for c, s in statuses.items() if s == "offline")
        stations = self.state.get("stations", {})
        lines = [f":satellite_antenna: *{title}*", f"{len(online)}/{len(statuses)} Spider stations online."]
        if offline:
            lines.append("Offline:")
            for code in offline:
                since = stations.get(code, {}).get("since")
                held = f" for {_fmt_duration(now - float(since))}" if since and title != "CORS monitoring started" else ""
                lines.append(f"• {self._label(code)}{held}")
        missing = sorted(set(self.names) - set(statuses))
        if missing:
            lines.append(f"Not in Spider, so not monitored: {', '.join(c.upper() for c in missing)}.")
        lines.append(_DASHBOARD + "cors")
        return "\n".join(lines)

    def _maybe_daily_summary(self, now: float) -> str | None:
        if self.summary_hour is None:
            return None
        local = datetime.fromtimestamp(now, tz=CAT)
        today = local.date().isoformat()
        if local.hour < self.summary_hour or self.state.get("last_summary_date") == today:
            return None
        self.state["last_summary_date"] = today
        stations = self.state.get("stations", {})
        statuses = {c: r.get("status", "offline") for c, r in stations.items()}
        day_ago = now - 86400
        changes = sum(1 for r in stations.values() for t in r.get("transitions", []) if t >= day_ago)
        text = self._network_message(f"Daily CORS network summary, {local.strftime('%d %b %Y')}", statuses, now)
        return text.replace("\n" + _DASHBOARD, f"\nStatus changes in the last 24 h: {changes}.\n" + _DASHBOARD, 1)


_monitor: CorsSlackMonitor | None = None
_post_lock = threading.Lock()


def get_monitor(state_path: Path) -> CorsSlackMonitor:
    global _monitor
    if _monitor is None:
        _monitor = CorsSlackMonitor(state_path)
    return _monitor


def post_messages_in_background(messages: list[str]) -> None:
    """Post in order without blocking the collector heartbeat."""
    if not messages:
        return

    def run() -> None:
        with _post_lock:
            for text in messages:
                ok, detail = post_cors_slack(text)
                if ok:
                    log.info("CORS Slack alert: %s", detail)
                else:
                    log.warning("CORS Slack alert failed: %s", detail)

    threading.Thread(target=run, name="cors-slack", daemon=True).start()
