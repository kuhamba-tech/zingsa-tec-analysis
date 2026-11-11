"""Post CORS station health changes and reports to the CORS management Slack channel.

Runs inside the live NTRIP collector only (the collector lock guarantees a
single alerter). Leica Spider Site Status is the source of truth. NTRIP
fallback rows are never used for station up/down, because the caster allows
one connection at a time and most stations always look idle through NTRIP.

Events posted to ``SLACK_CORS_WEBHOOK_URL``:

* station offline report: when it went down, where it is, last data received,
  its 7-day record and what else is down
* station back online: an incident report with start, end and downtime
* still-offline updates at 2 h, 6 h, 24 h and then daily
* several stations dropping together (one grouped report)
* a station flapping between online and offline
* Spider Site Status unreachable or stale, and restored
* the caster refusing the NTRIP account while no data arrives, and recovered
* live TEC not reaching the database, and resumed
* a daily network report and a weekly per-station report for managers

History figures come from the Spider status archive in Postgres
(``station_status_snapshots`` and ``station_status_events``). If the database
cannot be read, the history lines are left out rather than guessed.

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
from typing import Any, Callable, Protocol, Union

log = logging.getLogger(__name__)

CAT = timezone(timedelta(hours=2), "CAT")
_DASHBOARD = "https://zingsa-gnss-tec.vercel.app/"
STATE_VERSION = 2

Message = Union[str, Callable[[], str]]


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


def offline_alert_seconds() -> float:
    """How long a station must stay offline before it is reported (default 10 minutes)."""
    return max(0.0, _env_float("CORS_OFFLINE_ALERT_MINUTES", 10.0) * 60.0)


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


def _fmt_clock(epoch: float, ref: float | None = None) -> str:
    """Time only when on the same CAT day as ref, else date and time."""
    when = datetime.fromtimestamp(epoch, tz=CAT)
    if ref is not None and when.date() == datetime.fromtimestamp(ref, tz=CAT).date():
        return when.strftime("%H:%M CAT")
    return when.strftime("%d %b %H:%M CAT")


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


def _parse_time(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if hasattr(value, "timestamp"):
        try:
            ts = value
            if getattr(ts, "tzinfo", None) is None and hasattr(ts, "replace"):
                ts = ts.replace(tzinfo=timezone.utc)
            return float(ts.timestamp())
        except Exception:
            return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def _station_catalog() -> dict[str, dict[str, Any]]:
    try:
        from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

        return {
            s.code.lower().rstrip("_"): {"name": s.name, "lat": s.lat, "lon": s.lon}
            for s in ZIMBABWE_CORS_STATIONS
        }
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


# ---------------------------------------------------------------------------
# Station history from the Spider status archive
# ---------------------------------------------------------------------------


class StationHistory(Protocol):
    def station_record(self, code: str, hours: float = 168.0) -> dict[str, Any] | None: ...

    def offline_since(self, code: str) -> tuple[float, bool] | None: ...


def summarise_samples(
    samples: list[tuple[float, str]],
    *,
    now: float,
    min_run: int = 3,
    min_duration_s: float = 0.0,
    gap_s: float = 900.0,
) -> dict[str, Any] | None:
    """Uptime and outages from time-ordered (epoch, status) Spider samples.

    An outage is a run of at least ``min_run`` offline samples lasting at least
    ``min_duration_s``, the same rule the Slack alerts use, so short drops that
    were never reported are not counted.
    A gap in readings longer than ``gap_s`` (collector down) does not split an
    outage, but the unobserved time is not counted as downtime either.
    """
    rows = [(t, s) for t, s in samples if s in {"online", "offline"}]
    if not rows:
        return None
    online = sum(1 for _, s in rows if s == "online")
    outages: list[tuple[float, float, bool]] = []  # start, observed seconds offline, ongoing
    run_start: float | None = None
    run_n = 0
    run_s = 0.0
    prev_t: float | None = None

    def step(a: float, b: float) -> float:
        return b - a if b - a <= gap_s else 0.0

    for t, s in rows:
        if run_start is not None and prev_t is not None:
            run_s += step(prev_t, t)
        if s == "offline":
            if run_start is None:
                run_start, run_n, run_s = t, 0, 0.0
            run_n += 1
        elif run_start is not None:
            if run_n >= min_run and run_s >= min_duration_s:
                outages.append((run_start, run_s, False))
            run_start, run_n, run_s = None, 0, 0.0
        prev_t = t
    if run_start is not None and run_n >= min_run and prev_t is not None:
        open_s = run_s + step(prev_t, now)
        if open_s >= min_duration_s:
            outages.append((run_start, open_s, True))

    last_recovered = None
    run_open = False
    for t, s in rows:  # recovery time = first online reading after a counted outage
        if s == "offline":
            run_open = run_open or any(start == t for start, _, _ in outages)
        elif run_open:
            last_recovered, run_open = t, False
    return {
        "samples": len(rows),
        "uptime_pct": round(100.0 * online / len(rows), 1),
        "outages": len(outages),
        "downtime_s": sum(d for _, d, _ in outages),
        "longest_s": max((d for _, d, _ in outages), default=0.0),
        "last_recovered_at": last_recovered,
        "current_since": next((start for start, _, ongoing in outages if ongoing), None),
        "first_sample_at": rows[0][0],
    }


def _whole_window_outage(rec: dict[str, Any]) -> bool:
    """True when the station was already offline at the start of the window and still is."""
    since, first = rec.get("current_since"), rec.get("first_sample_at")
    return since is not None and first is not None and since <= first + 60 and rec.get("outages") == 1


class DbStationHistory:
    """Reads the Spider archive the collector already writes every heartbeat."""

    def __init__(self) -> None:
        self._db = None
        self._lock = threading.Lock()

    def _get(self):
        if self._db is None:
            from zgiis.db.station_status_db import StationStatusDB

            self._db = StationStatusDB()
        return self._db

    def station_record(self, code: str, hours: float = 168.0) -> dict[str, Any] | None:
        try:
            with self._lock:
                df = self._get().query_snapshots(hours=hours, station_code=code)
            if df is None or df.empty:
                return None
            samples = []
            for t, s in zip(df["time"], df["status"]):
                ts = _parse_time(t)
                if ts is not None:
                    samples.append((ts, str(s or "").lower()))
            samples.sort()
            return summarise_samples(samples, now=time.time(), min_duration_s=offline_alert_seconds())
        except Exception as exc:
            log.warning("CORS history for %s unavailable: %s", code, exc)
            return None

    def offline_since(self, code: str) -> tuple[float, bool] | None:
        """(epoch, exact). exact=False means offline since at least that time."""
        try:
            with self._lock:
                df = self._get().query_events(hours=24 * 90, station_code=code, limit=50)
            if df is None or df.empty:
                return None
            for _, row in df.sort_values("time", ascending=False).iterrows():
                status = str(row.get("status") or "").lower()
                kind = str(row.get("event_type") or "")
                if status != "offline":
                    return None  # latest event is not offline
                ts = _parse_time(row.get("time"))
                if ts is None:
                    return None
                if kind == "site_down":
                    return ts, True
                if kind == "initial_state":
                    continue  # look further back for the real drop
            oldest = _parse_time(df["time"].min())
            return (oldest, False) if oldest else None
        except Exception as exc:
            log.warning("CORS offline-since for %s unavailable: %s", code, exc)
            return None


# ---------------------------------------------------------------------------
# Monitor
# ---------------------------------------------------------------------------


class CorsSlackMonitor:
    def __init__(
        self,
        state_path: Path,
        *,
        now: Callable[[], float] = time.time,
        names: dict[str, str] | None = None,
        catalog: dict[str, dict[str, Any]] | None = None,
        history: StationHistory | None = None,
    ) -> None:
        self.state_path = Path(state_path)
        self.now = now
        self.catalog = catalog if catalog is not None else _station_catalog()
        if names is not None:
            self.catalog = {**{c: {"name": n} for c, n in names.items()}, **{
                c: v for c, v in self.catalog.items() if c in names
            }}
        self.history: StationHistory | None = history if history is not None else DbStationHistory()
        self.confirm_checks = max(1, _env_int("CORS_ALERT_CONFIRM_CHECKS", 3))
        self.offline_alert_s = offline_alert_seconds()
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
        raw = os.getenv("CORS_REMINDER_HOURS", "2,6,24")
        self.reminder_s = sorted(
            float(x) * 3600 for x in raw.split(",") if x.strip().replace(".", "", 1).isdigit()
        )
        hour = os.getenv("CORS_DAILY_SUMMARY_HOUR", "8").strip()
        self.summary_hour = int(hour) if hour.isdigit() and int(hour) < 24 else None
        weekday = os.getenv("CORS_WEEKLY_REPORT_WEEKDAY", "0").strip()  # 0 = Monday
        self.weekly_day = int(weekday) if weekday.isdigit() and int(weekday) < 7 else None
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

    def _name(self, code: str) -> str:
        return str((self.catalog.get(code) or {}).get("name") or "")

    def _label(self, code: str) -> str:
        name = self._name(code)
        return f"*{code.upper()}* ({name})" if name else f"*{code.upper()}*"

    def _location(self, code: str) -> str:
        info = self.catalog.get(code) or {}
        lat, lon = info.get("lat"), info.get("lon")
        if lat is None or lon is None:
            return ""
        return f"{lat:.4f}, {lon:.4f} (<https://www.google.com/maps?q={lat:.6f},{lon:.6f}|map>)"

    def _record(self, code: str, hours: float = 168.0) -> dict[str, Any] | None:
        if self.history is None:
            return None
        try:
            return self.history.station_record(code, hours)
        except Exception as exc:
            log.warning("CORS history lookup failed for %s: %s", code, exc)
            return None

    def _since(self, code: str, fallback: float | None) -> tuple[float | None, bool]:
        """Best known offline start: the archive's drop event, else our state."""
        found = None
        if self.history is not None:
            try:
                found = self.history.offline_since(code)
            except Exception:
                found = None
        if found:
            return found
        return fallback, False

    @staticmethod
    def _history_line(rec: dict[str, Any] | None, *, days: int = 7) -> str:
        if not rec:
            return ""
        parts = [f"online {rec['uptime_pct']}% of the time"]
        n = int(rec.get("outages") or 0)
        if n:
            parts.append(f"{n} outage{'s' if n != 1 else ''}")
            parts.append(f"{_fmt_duration(rec['downtime_s'])} offline in total")
            parts.append(f"longest {_fmt_duration(rec['longest_s'])}")
        else:
            parts.append("no outages")
        return f"• *Last {days} days:* " + " · ".join(parts)

    # ---------- main entry ----------
    def evaluate(
        self,
        spider_payload: dict[str, Any] | None,
        *,
        tec_age_s: float | None = None,
        tec_checked: bool = False,
        last_data_at: float | None = None,
        last_reject_at: float | None = None,
        last_seen_by_station: dict[str, float] | None = None,
    ) -> list[Message]:
        """Update state from one heartbeat and return Slack messages to post.

        Station reports are returned as callables so their database lookups run
        on the posting thread, not in the collector heartbeat.
        """
        now = self.now()
        messages: list[Message] = []
        payload = spider_payload or {}
        fetched = _parse_time(payload.get("fetched_at"))
        statuses = spider_statuses(payload)
        spider_fresh = bool(statuses) and fetched is not None and now - fetched <= self.spider_stale_s
        seen = {str(k).lower(): float(v) for k, v in (last_seen_by_station or {}).items() if v}

        first_run = not self.state
        if first_run:
            if not spider_fresh:
                return []  # wait for a real Spider reading before seeding
            self.state = {
                "version": STATE_VERSION,
                "stations": {},
                "spider": {},
                "caster": {},
                "tec": {},
                "flapping": {},
            }
            for code, status in statuses.items():
                rec = {"status": status, "since": now, "transitions": []}
                if status == "offline":
                    rec["seeded"] = True  # start unknown; reports use the archive instead
                self.state["stations"][code] = rec
            self.state["last_heartbeat"] = now
            today = datetime.fromtimestamp(now, tz=CAT).date().isoformat()
            self.state["last_summary_date"] = today
            self.state["last_weekly_date"] = today
            snapshot = dict(statuses)
            messages.append(lambda: self._network_report("CORS monitoring started", snapshot, now))
            self._save()
            return messages

        if int(self.state.get("version") or 1) < STATE_VERSION:
            # Offline stations seeded by version 1 have no real start time.
            for rec in self.state.get("stations", {}).values():
                if rec.get("status") == "offline" and not rec.get("transitions"):
                    rec["seeded"] = True
            self.state.setdefault("last_weekly_date", datetime.fromtimestamp(now, tz=CAT).date().isoformat())
            self.state["version"] = STATE_VERSION

        gap = now - float(self.state.get("last_heartbeat") or now)
        if gap > self.resume_gap_s:
            messages.append(
                f":arrows_counterclockwise: *CORS monitoring resumed* after {_fmt_duration(gap)} without checks. "
                "Station changes during that time are reported below once confirmed."
            )
        self.state["last_heartbeat"] = now

        messages.extend(self._check_spider(spider_fresh, fetched, payload.get("error"), now))
        if spider_fresh:
            messages.extend(self._check_stations(statuses, now, seen))
            messages.extend(self._check_reminders(now))
        messages.extend(self._check_caster(last_data_at, last_reject_at, now))
        if tec_checked:
            messages.extend(self._check_tec(tec_age_s, now))
        if spider_fresh:
            messages.extend(self._maybe_reports(now))
        self._save()
        return messages

    # ---------- checks ----------
    def _check_spider(self, fresh: bool, fetched: float | None, error: Any, now: float) -> list[Message]:
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

    def _check_stations(self, statuses: dict[str, str], now: float, seen: dict[str, float]) -> list[Message]:
        stations = self.state.setdefault("stations", {})
        flapping = self.state.setdefault("flapping", {})
        went_down: list[tuple[str, float]] = []  # code, went offline at
        came_up: list[tuple[str, float, float, bool]] = []  # code, down start, back at, start exact
        flap_msgs: list[Message] = []

        for code, status in statuses.items():
            rec = stations.get(code)
            if rec is None:
                stations[code] = {"status": status, "since": now, "transitions": []}
                continue
            if status == rec.get("status"):
                for key in ("pending", "pending_count", "pending_since"):
                    rec.pop(key, None)
                continue
            if rec.get("pending") != status:
                rec["pending"] = status
                rec["pending_count"] = 1
                rec["pending_since"] = now
            else:
                rec["pending_count"] = int(rec.get("pending_count") or 0) + 1
            if rec["pending_count"] < self.confirm_checks:
                continue
            if status == "offline" and now - float(rec.get("pending_since") or now) < self.offline_alert_s:
                continue  # not down long enough to report; a quick recovery sends nothing
            # Confirmed change. Date it from the first reading that showed it.
            changed_at = float(rec.get("pending_since") or now)
            previous_since = float(rec.get("since") or changed_at)
            was_seeded = bool(rec.pop("seeded", False))
            rec["status"] = status
            rec["since"] = changed_at
            rec["reminded"] = []
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
                went_down.append((code, changed_at))
            else:
                came_up.append((code, previous_since, changed_at, not was_seeded))

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

        messages: list[Message] = []
        total = len(statuses)
        online = sum(1 for s in statuses.values() if s == "online")
        offline_now = sorted(c for c, s in statuses.items() if s == "offline")
        tally = f"Network: {online}/{total} Spider stations online."
        if went_down:
            messages.append(self._down_report(went_down, now, offline_now, tally, seen))
        if came_up:
            messages.append(self._up_report(came_up, now, tally))
        messages.extend(flap_msgs)
        return messages

    def _down_report(
        self,
        went_down: list[tuple[str, float]],
        now: float,
        offline_now: list[str],
        tally: str,
        seen: dict[str, float],
    ) -> Message:
        reminders = ", ".join(f"{s / 3600:g}h" for s in self.reminder_s)
        footer = f"Updates follow at {reminders} if still offline." if reminders else ""

        def build() -> str:
            if len(went_down) >= self.mass_outage_n:
                lines = [
                    f":rotating_light: *{len(went_down)} CORS stations went offline together*",
                    "A shared cause is likely: power, the comms provider, or the Spider server, "
                    "rather than the individual receivers.",
                    "",
                ]
                for code, at in went_down:
                    rec = self._record(code)
                    up = f" · 7-day uptime {rec['uptime_pct']}%" if rec else ""
                    lines.append(f"• {self._label(code)}: offline since {_fmt_clock(at, now)}{up}")
                lines += ["", tally, footer, _DASHBOARD + "cors"]
                return "\n".join(line for line in lines if line is not None)

            blocks: list[str] = []
            for code, at in went_down:
                rec = self._record(code)
                others = [c.upper() for c in offline_now if c != code]
                rows = [
                    f":red_circle: *CORS station offline: {code.upper()}*" + (f" ({self._name(code)})" if self._name(code) else ""),
                    f"• *Went offline:* {_fmt_time(at)} (confirmed {_fmt_clock(now, at)})",
                ]
                loc = self._location(code)
                if loc:
                    rows.append(f"• *Location:* {loc}")
                if code in seen:
                    rows.append(f"• *Last data received by the collector:* {_fmt_time(seen[code])}")
                line = self._history_line(rec)
                if line:
                    rows.append(line + " (including this one)" if rec and rec.get("current_since") else line)
                if rec and rec.get("last_recovered_at"):
                    rows.append(f"• *Previous outage ended:* {_fmt_time(rec['last_recovered_at'])}")
                rows.append(
                    f"• *Also offline now:* {', '.join(others)} ({len(others)})" if others else "• *Also offline now:* none"
                )
                blocks.append("\n".join(rows))
            return "\n\n".join(blocks + ["\n".join(x for x in (tally, footer, _DASHBOARD + "cors") if x)])

        return build

    def _up_report(self, came_up: list[tuple[str, float, float, bool]], now: float, tally: str) -> Message:
        def build() -> str:
            blocks: list[str] = []
            for code, start, back, exact in came_up:
                if not exact:
                    found, exact_found = self._since(code, None)
                    if found is not None and found < start:
                        start, exact = found, exact_found
                rec = self._record(code)
                prefix = "" if exact else "at least "
                rows = [
                    f":large_green_circle: *CORS station back online: {code.upper()}*"
                    + (f" ({self._name(code)})" if self._name(code) else ""),
                    f"• *Offline:* {_fmt_time(start)} → {_fmt_clock(back, start)}",
                    f"• *Downtime:* {prefix}{_fmt_duration(back - start)}",
                ]
                line = self._history_line(rec)
                if line:
                    rows.append(line)
                blocks.append("\n".join(rows))
            return "\n\n".join(blocks + [tally])

        return build

    def _check_reminders(self, now: float) -> list[Message]:
        """Still-offline updates at each reminder age, then once a day."""
        if not self.reminder_s:
            return []
        due: list[tuple[str, float, float]] = []  # code, since, age
        flapping = self.state.get("flapping", {})
        for code, rec in self.state.get("stations", {}).items():
            if rec.get("status") != "offline" or rec.get("seeded") or code in flapping:
                continue
            since = float(rec.get("since") or now)
            age = now - since
            reminded = [float(x) for x in rec.get("reminded", [])]
            marks = list(self.reminder_s)
            last = marks[-1]
            while last + 86400 <= age:
                last += 86400
                marks.append(last)
            pending = [m for m in marks if m <= age and m not in reminded]
            if pending:
                rec["reminded"] = sorted(set(reminded) | set(pending))
                due.append((code, since, age))
        if not due:
            return []

        def build() -> str:
            lines = [":hourglass_flowing_sand: *Still offline*"]
            for code, since, age in sorted(due, key=lambda d: -d[2]):
                lines.append(f"• {self._label(code)}: offline for *{_fmt_duration(age)}*, since {_fmt_time(since)}")
            lines.append(_DASHBOARD + "cors")
            return "\n".join(lines)

        return [build]

    def _check_caster(self, last_data_at: float | None, last_reject_at: float | None, now: float) -> list[Message]:
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

    def _check_tec(self, age_s: float | None, now: float) -> list[Message]:
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

    # ---------- reports ----------
    def _offline_lines(self, statuses: dict[str, str], now: float) -> list[str]:
        stations = self.state.get("stations", {})
        out = []
        rows = []
        for code in sorted(c for c, s in statuses.items() if s == "offline"):
            rec = stations.get(code, {})
            fallback = None if rec.get("seeded") else rec.get("since")
            since, exact = self._since(code, float(fallback) if fallback else None)
            rows.append((code, since, exact))
        rows.sort(key=lambda r: r[1] if r[1] is not None else float("inf"))
        for code, since, exact in rows:
            if since is None:
                out.append(f"• {self._label(code)}: offline, start time not on record")
            elif exact:
                out.append(f"• {self._label(code)}: offline since {_fmt_time(since)} (*{_fmt_duration(now - since)}*)")
            else:
                out.append(
                    f"• {self._label(code)}: offline since before {_fmt_time(since)} "
                    f"(*more than {_fmt_duration(now - since)}*)"
                )
        return out

    def _network_report(self, title: str, statuses: dict[str, str], now: float) -> str:
        online = sum(1 for s in statuses.values() if s == "online")
        lines = [f":satellite_antenna: *{title}*", f"{online}/{len(statuses)} Spider stations online."]
        offline = self._offline_lines(statuses, now)
        if offline:
            lines.append("")
            lines.append("*Offline:*")
            lines.extend(offline)
        missing = sorted(set(self.catalog) - set(statuses))
        if missing:
            lines.append("")
            lines.append(f"Not in Spider, so not monitored: {', '.join(c.upper() for c in missing)}.")
        lines.append(_DASHBOARD + "cors")
        return "\n".join(lines)

    def _daily_report(self, statuses: dict[str, str], now: float, day_label: str) -> str:
        text = self._network_report(f"Daily CORS network report, {day_label}", statuses, now)
        recent: list[str] = []
        for code in sorted(statuses):
            rec = self._record(code, hours=24)
            if rec and _whole_window_outage(rec):
                continue  # already listed under Offline
            if rec and rec.get("outages"):
                recent.append(
                    f"• {self._label(code)}: {rec['outages']} outage{'s' if rec['outages'] != 1 else ''}, "
                    f"{_fmt_duration(rec['downtime_s'])} offline, online {rec['uptime_pct']}%"
                )
        block = "*Outages in the last 24 hours:*\n" + ("\n".join(recent) if recent else "• none")
        return text.replace("\n" + _DASHBOARD, "\n\n" + block + "\n" + _DASHBOARD, 1)

    def _weekly_report(self, statuses: dict[str, str], now: float) -> str:
        rows = []
        for code in sorted(statuses):
            rows.append((code, self._record(code, hours=168)))
        known = [(c, r) for c, r in rows if r]
        known.sort(key=lambda cr: (cr[1]["uptime_pct"], -cr[1]["outages"]))
        start = datetime.fromtimestamp(now - 7 * 86400, tz=CAT).strftime("%d %b")
        end = datetime.fromtimestamp(now, tz=CAT).strftime("%d %b %Y")
        lines = [f":bar_chart: *Weekly CORS station report, {start} to {end}*"]
        if known:
            avg = sum(r["uptime_pct"] for _, r in known) / len(known)
            total_out = sum(r["outages"] for _, r in known)
            clean = sum(1 for _, r in known if not r["outages"])
            lines.append(
                f"Network average uptime {avg:.1f}% · {total_out} outages · "
                f"{clean}/{len(known)} stations with no confirmed outage"
            )
            lines.append("")
            lines.append("*By station, lowest uptime first:*")
            for code, r in known:
                mark = ":red_circle:" if r.get("current_since") else (
                    ":large_yellow_circle:" if r["uptime_pct"] < 95 else ":large_green_circle:"
                )
                detail = "offline the whole week" if _whole_window_outage(r) else (
                    f"{r['outages']} outage{'s' if r['outages'] != 1 else ''}, {_fmt_duration(r['downtime_s'])} down, "
                    f"longest {_fmt_duration(r['longest_s'])}"
                    if r["outages"]
                    else "no outages"
                )
                now_text = " · *offline now*" if r.get("current_since") else ""
                lines.append(f"{mark} {self._label(code)}: {r['uptime_pct']}% · {detail}{now_text}")
        missing = [c.upper() for c, r in rows if not r]
        if missing:
            lines.append(f"No archive data for: {', '.join(missing)}.")
        lines.append(
            "Uptime is the share of Spider readings that were online. Outages count only drops lasting "
            f"{_fmt_duration(self.offline_alert_s)} or more (the alert threshold); downtime counts only time "
            "the collector was watching."
        )
        lines.append(_DASHBOARD + "cors")
        return "\n".join(lines)

    def _maybe_reports(self, now: float) -> list[Message]:
        if self.summary_hour is None:
            return []
        local = datetime.fromtimestamp(now, tz=CAT)
        if local.hour < self.summary_hour:
            return []
        today = local.date().isoformat()
        statuses = {c: r.get("status", "offline") for c, r in self.state.get("stations", {}).items()}
        out: list[Message] = []
        if self.state.get("last_summary_date") != today:
            self.state["last_summary_date"] = today
            label = local.strftime("%d %b %Y")
            out.append(lambda: self._daily_report(statuses, now, label))
        if (
            self.weekly_day is not None
            and local.weekday() == self.weekly_day
            and self.state.get("last_weekly_date") != today
        ):
            self.state["last_weekly_date"] = today
            out.append(lambda: self._weekly_report(statuses, now))
        return out


def render(message: Message) -> str:
    return message() if callable(message) else message


_monitor: CorsSlackMonitor | None = None
_post_lock = threading.Lock()


def get_monitor(state_path: Path) -> CorsSlackMonitor:
    global _monitor
    if _monitor is None:
        _monitor = CorsSlackMonitor(state_path)
    return _monitor


def post_messages_in_background(messages: list[Message]) -> None:
    """Build (with database lookups) and post in order, off the collector heartbeat."""
    if not messages:
        return

    def run() -> None:
        with _post_lock:
            for item in messages:
                try:
                    text = render(item)
                except Exception:
                    log.exception("CORS Slack report could not be built")
                    continue
                ok, detail = post_cors_slack(text)
                if ok:
                    log.info("CORS Slack alert: %s", detail)
                else:
                    log.warning("CORS Slack alert failed: %s", detail)

    threading.Thread(target=run, name="cors-slack", daemon=True).start()
