"""Explicit, timestamped context. Ground field is never replaced by GOES."""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import math
import time
import threading
import pandas as pd
import requests

_cache = {}
_lock = threading.Lock()


def _noaa(name, url, field):
    with _lock:
        previous = _cache.get(name)
        if previous and time.monotonic() - previous[0] < 60:
            return previous[1]
    try:
        response = requests.get(url, timeout=7)
        response.raise_for_status()
        values = []
        for row in response.json():
            if row.get('active') is False:
                continue
            value = float(row[field]) if row.get(field) is not None else None
            if value is not None and math.isfinite(value):
                # SWPC time_tag is explicitly UTC, even when no suffix is supplied.
                stamp = pd.Timestamp(row['time_tag'])
                stamp = stamp.tz_localize('UTC') if stamp.tzinfo is None else stamp.tz_convert('UTC')
                values.append({'t': stamp.isoformat(), 'value': value})
        # Select the active upstream instrument; never mix inactive backup values.
        unique = {point['t']: point for point in values}
        result = {'points': [unique[t] for t in sorted(unique)], 'fetch_failed': False}
        with _lock:
            _cache[name] = (time.monotonic(), result)
        return result
    except Exception:
        return {'points': previous[1]['points'] if previous else [], 'fetch_failed': True}


def scientific_context(db, sw_df, station_id, hours):
    from zgiis.space_weather.solar_activity import NOAA_MAG_1D_URL, NOAA_PLASMA_1D_URL
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=hours)
    def source(name, unit, origin, points, **extra):
        pts = [p for p in points if start <= pd.Timestamp(p['t']).to_pydatetime() <= now]
        latest = max((p['t'] for p in pts if p.get('value') is not None), default=None)
        return {'id': name, 'unit': unit, 'source': origin, 'points': pts,
                'latest_observation': latest, 'age_seconds': (now-pd.Timestamp(latest).to_pydatetime()).total_seconds() if latest else None, **extra}
    data = db.query_dataframe(station_id=station_id, start=start.isoformat(), end=now.isoformat())
    sources = []
    ground = []
    for component in ('bx_nt', 'by_nt', 'bz_nt'):
        pts = []
        for row in data.itertuples():
            metadata = row.metadata or {}
            value = metadata.get(component)
            if value is not None and not row.quality_flags and math.isfinite(float(value)):
                pts.append({'t': pd.Timestamp(row.time).isoformat(), 'value': float(value)})
        ground.append(pts)
        sources.append(source(component, 'nT', f'{station_id} supplied ground component; axis orientation requires station metadata', pts))
    paired = {p['t']: [p['value'], None] for p in ground[0]}
    for point in ground[1]:
        if point['t'] in paired: paired[point['t']][1] = point['value']
    vectors = [(t, v) for t, v in sorted(paired.items()) if None not in v]
    horizontal = [(t, math.hypot(*v)) for t, v in vectors]
    derivative = []
    vector_derivative = []
    cadence = db.station_config(station_id).get('expected_cadence_seconds')
    for (t0, v0), (t1, v1) in zip(horizontal, horizontal[1:]):
        dt = (pd.Timestamp(t1)-pd.Timestamp(t0)).total_seconds()
        if cadence and 0 < dt <= cadence*1.5:
            derivative.append({'t': t1, 'value': (v1-v0)/dt*60})
    sources.append(source('dhdt', 'nT/min', 'dH/dt where H=sqrt(Bx^2+By^2); valid adjoining ground samples only', derivative))
    for (t0, v0), (t1, v1) in zip(vectors, vectors[1:]):
        dt = (pd.Timestamp(t1)-pd.Timestamp(t0)).total_seconds()
        if cadence and 0 < dt <= cadence*1.5:
            vector_derivative.append({'t': t1, 'value': math.hypot(v1[0]-v0[0], v1[1]-v0[1])/dt*60})
    sources.append(source('dbdt_horizontal', 'nT/min', '|dBh/dt| = sqrt((dBx/dt)^2+(dBy/dt)^2); horizontal vector derivative', vector_derivative))
    with ThreadPoolExecutor(max_workers=2) as executor:
        jobs = [('imf_bz', 'nT', NOAA_MAG_1D_URL, 'bz_gsm'), ('solar_wind', 'km/s', NOAA_PLASMA_1D_URL, 'proton_speed')]
        futures = [(name, unit, url, executor.submit(_noaa, name, url, field)) for name, unit, url, field in jobs]
        for name, unit, url, future in futures:
            result = future.result()
            sources.append(source(name, unit, url, result['points'], fetch_failed=result['fetch_failed'], note='L1 context; not time-shifted to Earth. Upstream feed supplies at most its published recent window.'))
    kp = []
    if not sw_df.empty and 'kp' in sw_df:
        kp = [{'t': pd.Timestamp(row.time).isoformat(), 'value': float(row.kp)} for row in sw_df.itertuples() if pd.notna(row.kp)]
    sources.append(source('kp', 'Kp', 'space_weather_log archive / NOAA planetary Kp', kp))
    sym = []
    try:
        with db._lock, db._conn.cursor() as cursor:
            cursor.execute('SELECT time,sym_h FROM kyoto_asysym WHERE time >= %s AND time <= %s AND sym_h IS NOT NULL ORDER BY time', (start, now))
            sym = [{'t': t.isoformat(), 'value': float(v)} for t, v in cursor.fetchall()]
    except Exception:
        # A missing archive is unavailable, never a substituted Dst or older published window.
        db._conn.rollback()
    sources.append(source('sym_h', 'nT', 'kyoto_asysym archive / WDC Kyoto SYM-H', sym))
    return {'station_id': station_id, 'window_start': start.isoformat(), 'window_end': now.isoformat(), 'sources': sources,
            'alignment': 'Exact UTC shared axis; no interpolation, propagation correction or field substitution'}
