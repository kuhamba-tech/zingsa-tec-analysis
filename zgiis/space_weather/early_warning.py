"""ZINGSA Space Weather Early Warning evaluation.

Three alert streams are kept distinct:
  - official_noaa: international bulletins and observed G-scale from measured Kp
  - zingsa_experimental: ZINGSA L1 solar-wind / IMF sustained thresholds (driver risk only)
  - zimbabwe_gnss: measured CORS VTEC / S4 impacts over Zimbabwe

Solar-wind and Bz rules require a sustained window of timestamped samples.
A single latest sample never triggers those driver alerts alone.
"""
from __future__ import annotations

import math
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

Authority = Literal["official_noaa", "zingsa_experimental", "zimbabwe_gnss"]
Category = Literal["solar_activity", "solar_wind_imf", "geomagnetic", "zimbabwe_gnss"]
Severity = Literal["advisory", "watch", "warning", "severe"]
Status = Literal["active", "watch", "resolved"]

SUSTAIN_MINUTES = 10
SPEED_ADVISORY_KMS = 500.0
SPEED_WATCH_KMS = 700.0
BZ_WATCH_NT = -5.0
BZ_WARNING_NT = -10.0
VTEC_HIGH_TECU = 40.0
S4_MODERATE = 0.35
COOLDOWN_MINUTES = 30
STALE_MAX_AGE_MINUTES = 30


@dataclass(frozen=True)
class Sample:
    time: datetime
    value: float


@dataclass
class EarlyWarningAlert:
    alert_id: str
    rule_id: str
    authority: Authority
    category: Category
    severity: Severity
    status: Status
    title: str
    message: str
    observed_value: float | None
    threshold: float | None
    unit: str | None
    duration_minutes: float | None
    observation_time: str | None
    data_age_minutes: float | None
    source: str
    first_detected: str
    last_updated: str
    resolved_at: str | None = None
    related: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _utc(dt: datetime | None = None) -> datetime:
    if dt is None:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return _utc(dt).isoformat().replace("+00:00", "Z") if dt else None


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def parse_sample_time(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return _utc(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        return _utc(datetime.fromisoformat(text.replace("Z", "+00:00")))
    except ValueError:
        return None


def sustained_condition(
    samples: list[Sample],
    *,
    predicate,
    window_minutes: float = SUSTAIN_MINUTES,
    now: datetime | None = None,
) -> tuple[bool, float | None, Sample | None]:
    """Return whether `predicate` held continuously for `window_minutes` ending at the latest sample."""
    clock = _utc(now)
    usable = [s for s in samples if predicate(s.value)]
    if not samples:
        return False, None, None
    ordered = sorted(samples, key=lambda s: s.time)
    latest = ordered[-1]
    age_min = (clock - latest.time).total_seconds() / 60.0
    if age_min > STALE_MAX_AGE_MINUTES:
        return False, age_min, latest
    if not predicate(latest.value):
        return False, age_min, latest

    start = latest.time
    for sample in reversed(ordered):
        if not predicate(sample.value):
            break
        start = sample.time
    duration = (latest.time - start).total_seconds() / 60.0
    if duration + 1e-9 < window_minutes:
        return False, age_min, latest
    # Prefer counting only samples that actually satisfy the predicate.
    if usable and (latest.time - start).total_seconds() / 60.0 >= window_minutes:
        return True, age_min, latest
    return False, age_min, latest


def noaa_g_scale(kp: float | None) -> str | None:
    if kp is None or not math.isfinite(kp):
        return None
    if kp >= 9:
        return "G5"
    if kp >= 8:
        return "G4"
    if kp >= 7:
        return "G3"
    if kp >= 6:
        return "G2"
    if kp >= 5:
        return "G1"
    return None


def _alert(
    *,
    rule_id: str,
    authority: Authority,
    category: Category,
    severity: Severity,
    status: Status,
    title: str,
    message: str,
    source: str,
    observed_value: float | None = None,
    threshold: float | None = None,
    unit: str | None = None,
    duration_minutes: float | None = None,
    observation_time: datetime | None = None,
    data_age_minutes: float | None = None,
    related: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> EarlyWarningAlert:
    clock = _utc(now)
    stamp = _iso(clock) or clock.isoformat()
    return EarlyWarningAlert(
        alert_id=f"ew-{rule_id}-{uuid.uuid4().hex[:10]}",
        rule_id=rule_id,
        authority=authority,
        category=category,
        severity=severity,
        status=status,
        title=title,
        message=message,
        observed_value=observed_value,
        threshold=threshold,
        unit=unit,
        duration_minutes=None if duration_minutes is None else round(duration_minutes, 1),
        observation_time=_iso(observation_time),
        data_age_minutes=None if data_age_minutes is None else round(data_age_minutes, 1),
        source=source,
        first_detected=stamp,
        last_updated=stamp,
        related=related or {},
    )


def evaluate_solar_wind_imf(
    speed_samples: list[Sample],
    bz_samples: list[Sample],
    *,
    now: datetime | None = None,
) -> list[EarlyWarningAlert]:
    """ZINGSA L1 heliospheric driver rules. Never declare a confirmed geomagnetic storm here."""
    clock = _utc(now)
    out: list[EarlyWarningAlert] = []

    def duration_ending_at(samples: list[Sample], predicate) -> float:
        ordered = sorted(samples, key=lambda s: s.time)
        if not ordered or not predicate(ordered[-1].value):
            return 0.0
        start = ordered[-1].time
        for sample in reversed(ordered):
            if not predicate(sample.value):
                break
            start = sample.time
        return (ordered[-1].time - start).total_seconds() / 60.0

    hit_500, age_speed, latest_speed = sustained_condition(
        speed_samples, predicate=lambda v: v >= SPEED_ADVISORY_KMS, now=clock
    )
    hit_700, _, _ = sustained_condition(
        speed_samples, predicate=lambda v: v >= SPEED_WATCH_KMS, now=clock
    )
    hit_bz5, age_bz, latest_bz = sustained_condition(
        bz_samples, predicate=lambda v: v <= BZ_WATCH_NT, now=clock
    )
    hit_bz10, _, _ = sustained_condition(
        bz_samples, predicate=lambda v: v <= BZ_WARNING_NT, now=clock
    )

    if hit_700 and latest_speed:
        out.append(
            _alert(
                rule_id="sw_speed_700",
                authority="zingsa_experimental",
                category="solar_wind_imf",
                severity="watch",
                status="watch",
                title="High-Speed Solar Wind Watch",
                message=(
                    f"Solar-wind speed stayed at or above {SPEED_WATCH_KMS:.0f} km/s for at least "
                    f"{SUSTAIN_MINUTES} minutes at L1. This is a ZINGSA heliospheric driver watch — "
                    "not a confirmed geomagnetic storm."
                ),
                observed_value=latest_speed.value,
                threshold=SPEED_WATCH_KMS,
                unit="km/s",
                duration_minutes=duration_ending_at(speed_samples, lambda v: v >= SPEED_WATCH_KMS),
                observation_time=latest_speed.time,
                data_age_minutes=age_speed,
                source="NOAA SWPC RTSW plasma",
                now=clock,
            )
        )
    elif hit_500 and latest_speed:
        out.append(
            _alert(
                rule_id="sw_speed_500",
                authority="zingsa_experimental",
                category="solar_wind_imf",
                severity="advisory",
                status="active",
                title="Elevated Solar Wind Advisory",
                message=(
                    f"Solar-wind speed stayed at or above {SPEED_ADVISORY_KMS:.0f} km/s for at least "
                    f"{SUSTAIN_MINUTES} minutes at L1. Driver advisory only — confirm with observed "
                    "Kp and Zimbabwe CORS TEC / S4."
                ),
                observed_value=latest_speed.value,
                threshold=SPEED_ADVISORY_KMS,
                unit="km/s",
                duration_minutes=duration_ending_at(speed_samples, lambda v: v >= SPEED_ADVISORY_KMS),
                observation_time=latest_speed.time,
                data_age_minutes=age_speed,
                source="NOAA SWPC RTSW plasma",
                now=clock,
            )
        )

    if hit_bz10 and latest_bz:
        out.append(
            _alert(
                rule_id="imf_bz_m10",
                authority="zingsa_experimental",
                category="solar_wind_imf",
                severity="warning",
                status="watch",
                title="Enhanced Geomagnetic Risk Warning",
                message=(
                    f"IMF Bz stayed at or below {BZ_WARNING_NT:.0f} nT for at least {SUSTAIN_MINUTES} minutes. "
                    "Geomagnetic coupling risk is elevated; confirmation requires observed Kp and "
                    "Zimbabwe CORS TEC / S4."
                ),
                observed_value=latest_bz.value,
                threshold=BZ_WARNING_NT,
                unit="nT",
                duration_minutes=duration_ending_at(bz_samples, lambda v: v <= BZ_WARNING_NT),
                observation_time=latest_bz.time,
                data_age_minutes=age_bz,
                source="NOAA SWPC RTSW magnetometer",
                now=clock,
            )
        )
    elif hit_bz5 and latest_bz:
        out.append(
            _alert(
                rule_id="imf_bz_m5",
                authority="zingsa_experimental",
                category="solar_wind_imf",
                severity="watch",
                status="watch",
                title="Southward IMF Watch",
                message=(
                    f"IMF Bz stayed at or below {BZ_WATCH_NT:.0f} nT for at least {SUSTAIN_MINUTES} minutes. "
                    "Southward Bz favours coupling; confirm with observed Kp, SYM-H and Zimbabwe TEC/S4."
                ),
                observed_value=latest_bz.value,
                threshold=BZ_WATCH_NT,
                unit="nT",
                duration_minutes=duration_ending_at(bz_samples, lambda v: v <= BZ_WATCH_NT),
                observation_time=latest_bz.time,
                data_age_minutes=age_bz,
                source="NOAA SWPC RTSW magnetometer",
                now=clock,
            )
        )

    # Combined rule: both conditions sustained for the window ending now.
    if hit_500 and hit_bz5 and latest_speed and latest_bz:
        out.append(
            _alert(
                rule_id="sw_bz_combined",
                authority="zingsa_experimental",
                category="solar_wind_imf",
                severity="warning",
                status="watch",
                title="Elevated Geomagnetic Storm Potential",
                message=(
                    f"Speed ≥ {SPEED_ADVISORY_KMS:.0f} km/s and Bz ≤ {BZ_WATCH_NT:.0f} nT were both sustained "
                    f"for at least {SUSTAIN_MINUTES} minutes. Potential only — not a confirmed geomagnetic storm."
                ),
                observed_value=latest_speed.value,
                threshold=SPEED_ADVISORY_KMS,
                unit="km/s",
                duration_minutes=min(
                    duration_ending_at(speed_samples, lambda v: v >= SPEED_ADVISORY_KMS),
                    duration_ending_at(bz_samples, lambda v: v <= BZ_WATCH_NT),
                ),
                observation_time=max(latest_speed.time, latest_bz.time),
                data_age_minutes=max(age_speed or 0.0, age_bz or 0.0),
                source="NOAA SWPC RTSW plasma + magnetometer",
                related={"bz_nT": latest_bz.value, "speed_km_s": latest_speed.value},
                now=clock,
            )
        )

    return out


def evaluate_geomagnetic_observed(
    *,
    kp: float | None,
    dst: float | None,
    sym_h: float | None = None,
    kp_time: datetime | None = None,
    dst_time: datetime | None = None,
    now: datetime | None = None,
) -> list[EarlyWarningAlert]:
    """Official NOAA G-scale from observed Kp, with supporting Dst/SYM-H when present."""
    clock = _utc(now)
    out: list[EarlyWarningAlert] = []
    kp_val = _finite(kp)
    g = noaa_g_scale(kp_val)
    if kp_val is not None and g:
        severity: Severity = "severe" if kp_val >= 7 else "warning" if kp_val >= 6 else "watch"
        out.append(
            _alert(
                rule_id=f"noaa_g_{g.lower()}",
                authority="official_noaa",
                category="geomagnetic",
                severity=severity,
                status="active",
                title=f"Observed NOAA {g} Geomagnetic Storm",
                message=(
                    f"Observed planetary Kp is {kp_val:.1f}, which maps to NOAA {g}. "
                    "This uses the observed Kp index, not a forecast Kp."
                ),
                observed_value=kp_val,
                threshold=5.0,
                unit="Kp",
                observation_time=kp_time,
                data_age_minutes=((clock - _utc(kp_time)).total_seconds() / 60.0) if kp_time else None,
                source="NOAA SWPC observed Kp",
                related={
                    "g_scale": g,
                    "dst_nT": _finite(dst),
                    "sym_h_nT": _finite(sym_h),
                    "dst_time": _iso(dst_time),
                },
                now=clock,
            )
        )
    return out


def evaluate_zimbabwe_gnss(
    *,
    mean_vtec: float | None,
    s4: float | None,
    region_vtec: dict[str, float | None] | None = None,
    observation_time: datetime | None = None,
    now: datetime | None = None,
) -> list[EarlyWarningAlert]:
    """Regional/national GNSS impact only from measured CORS quantities."""
    clock = _utc(now)
    out: list[EarlyWarningAlert] = []
    vtec = _finite(mean_vtec)
    s4_val = _finite(s4)
    age = ((clock - _utc(observation_time)).total_seconds() / 60.0) if observation_time else None

    if vtec is not None and vtec >= VTEC_HIGH_TECU:
        out.append(
            _alert(
                rule_id="zw_vtec_high",
                authority="zimbabwe_gnss",
                category="zimbabwe_gnss",
                severity="warning" if vtec >= 100 else "watch",
                status="active",
                title="Zimbabwe Network VTEC High",
                message=(
                    f"Network mean VTEC is {vtec:.1f} TECU (limit {VTEC_HIGH_TECU:.0f} TECU). "
                    "High TEC increases GNSS range delay; it is not by itself a positioning-failure claim."
                ),
                observed_value=vtec,
                threshold=VTEC_HIGH_TECU,
                unit="TECU",
                observation_time=observation_time,
                data_age_minutes=age,
                source="Zimbabwe CORS GOPI network mean",
                related={"regions": region_vtec or {}},
                now=clock,
            )
        )

    if s4_val is not None and s4_val >= S4_MODERATE:
        out.append(
            _alert(
                rule_id="zw_s4_moderate",
                authority="zimbabwe_gnss",
                category="zimbabwe_gnss",
                severity="severe" if s4_val >= 0.7 else "warning" if s4_val >= 0.5 else "watch",
                status="active",
                title="Zimbabwe Scintillation Advisory",
                message=(
                    f"Measured S4 is {s4_val:.2f} (moderate line {S4_MODERATE:.2f}). "
                    "Scintillation can cause loss of lock; confirm on the CORS stations that reported it."
                ),
                observed_value=s4_val,
                threshold=S4_MODERATE,
                unit="S4",
                observation_time=observation_time,
                data_age_minutes=age,
                source="Zimbabwe CORS scintillation",
                now=clock,
            )
        )

    if region_vtec:
        for region, value in region_vtec.items():
            number = _finite(value)
            if number is None or number < VTEC_HIGH_TECU:
                continue
            out.append(
                _alert(
                    rule_id=f"zw_vtec_{region}",
                    authority="zimbabwe_gnss",
                    category="zimbabwe_gnss",
                    severity="watch",
                    status="active",
                    title=f"{region.title()} Zimbabwe VTEC High",
                    message=(
                        f"{region.title()} band mean VTEC is {number:.1f} TECU. "
                        "Regional advisory only; a national mean is not substituted for a missing band."
                    ),
                    observed_value=number,
                    threshold=VTEC_HIGH_TECU,
                    unit="TECU",
                    observation_time=observation_time,
                    data_age_minutes=age,
                    source="Zimbabwe CORS latitude-band mean",
                    now=clock,
                )
            )
    return out


def evaluate_solar_activity_events(
    *,
    swpc_alerts: list[dict[str, Any]] | None,
    donki_cmes: list[dict[str, Any]] | None,
    donki_flares: list[dict[str, Any]] | None,
    now: datetime | None = None,
    max_age_hours: float = 72.0,
) -> list[EarlyWarningAlert]:
    """Official solar event cards from recent SWPC / DONKI records only."""
    clock = _utc(now)
    cutoff = clock - timedelta(hours=max_age_hours)
    out: list[EarlyWarningAlert] = []

    def recent(stamp: datetime | None) -> bool:
        return stamp is not None and stamp >= cutoff

    seen_codes: set[str] = set()
    for row in swpc_alerts or []:
        if not isinstance(row, dict):
            continue
        bulletin = row.get("bulletin") if isinstance(row.get("bulletin"), dict) else {}
        code = str(bulletin.get("code") or row.get("product_id") or "SWPC").strip()
        headline = str(bulletin.get("headline") or row.get("message") or "").strip()
        issued = parse_sample_time(row.get("issue_datetime") or bulletin.get("issue_time"))
        if not headline and not code:
            continue
        if not recent(issued):
            continue
        key = code.lower()
        if key in seen_codes:
            continue
        seen_codes.add(key)
        out.append(
            _alert(
                rule_id=f"swpc_{key}",
                authority="official_noaa",
                category="solar_activity",
                severity="watch",
                status="watch",
                title=f"NOAA SWPC {code}",
                message=headline or f"NOAA SWPC bulletin {code}",
                observation_time=issued,
                data_age_minutes=((clock - issued).total_seconds() / 60.0) if issued else None,
                source="NOAA SWPC alerts, watches and warnings",
                related={"product_id": row.get("product_id"), "serial": bulletin.get("serial")},
                now=clock,
            )
        )

    cme_added = 0
    for cme in donki_cmes or []:
        if cme_added >= 3 or not isinstance(cme, dict):
            continue
        start = parse_sample_time(cme.get("startTime") or cme.get("start_time"))
        if not recent(start):
            continue
        note = str(cme.get("note") or cme.get("sourceLocation") or "DONKI CME").strip()
        activity_id = str(cme.get("activityID") or cme.get("id") or f"cme-{cme_added}")
        out.append(
            _alert(
                rule_id=f"donki_cme_{activity_id}",
                authority="official_noaa",
                category="solar_activity",
                severity="advisory",
                status="watch",
                title="DONKI CME record",
                message=(
                    f"{note} Earth impact is only claimed when the official catalogue assesses it; "
                    "an Earth-facing CME is not automatically a geomagnetic storm."
                ),
                observation_time=start,
                source="NASA DONKI CME",
                related={
                    "activity_id": activity_id,
                    "catalog": cme.get("catalog"),
                },
                now=clock,
            )
        )
        cme_added += 1

    flare_added = 0
    for flare in donki_flares or []:
        if flare_added >= 2 or not isinstance(flare, dict):
            continue
        begin = parse_sample_time(flare.get("beginTime") or flare.get("peakTime"))
        if not recent(begin):
            continue
        klass = str(flare.get("classType") or flare.get("flrID") or "flare").strip()
        out.append(
            _alert(
                rule_id=f"donki_flare_{klass.lower()}_{begin.strftime('%Y%m%d%H%M') if begin else flare_added}",
                authority="official_noaa",
                category="solar_activity",
                severity="advisory",
                status="watch",
                title=f"DONKI flare {klass}",
                message=f"Recorded solar flare class {klass} from NASA DONKI.",
                observation_time=begin,
                source="NASA DONKI flare",
                now=clock,
            )
        )
        flare_added += 1
    return out


def summarise_alerts(alerts: list[EarlyWarningAlert] | list[dict[str, Any]]) -> dict[str, Any]:
    rows = [a.to_dict() if isinstance(a, EarlyWarningAlert) else a for a in alerts]
    active = [r for r in rows if r.get("status") in {"active", "watch"}]
    rank = {"advisory": 1, "watch": 2, "warning": 3, "severe": 4}
    highest = "none"
    for row in active:
        sev = str(row.get("severity") or "advisory")
        if rank.get(sev, 0) > rank.get(highest, 0):
            highest = sev
    return {
        "highest_severity": highest if active else "none",
        "active_count": len(active),
        "by_authority": {
            "official_noaa": sum(1 for r in active if r.get("authority") == "official_noaa"),
            "zingsa_experimental": sum(1 for r in active if r.get("authority") == "zingsa_experimental"),
            "zimbabwe_gnss": sum(1 for r in active if r.get("authority") == "zimbabwe_gnss"),
        },
        "cooldown_minutes": COOLDOWN_MINUTES,
        "sustain_minutes": SUSTAIN_MINUTES,
    }


def should_suppress(
    existing: dict[str, Any] | None,
    candidate: EarlyWarningAlert,
    *,
    now: datetime | None = None,
    cooldown_minutes: float = COOLDOWN_MINUTES,
) -> bool:
    """Duplicate suppression for the same rule while still active / inside cooldown."""
    if not existing:
        return False
    if str(existing.get("rule_id")) != candidate.rule_id:
        return False
    if str(existing.get("status")) in {"active", "watch"}:
        return True
    last = parse_sample_time(existing.get("last_updated") or existing.get("first_detected"))
    if not last:
        return False
    return (_utc(now) - last) < timedelta(minutes=cooldown_minutes)
