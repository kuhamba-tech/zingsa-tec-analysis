"""Verified Kyoto HAPI ASY/SYM data, with explicit publication delay."""
from __future__ import annotations

import copy
import json
import math
import threading
import time
from datetime import datetime, timedelta, timezone
from collections import OrderedDict

import requests

BASE = "https://wdc.kugi.kyoto-u.ac.jp/hapi"
DATASET = "min_asysym"
PROVISIONAL = "min_asysym_provisional"
FIELDS = {"ASY-D":"asyDValue", "ASY-H":"asyHValue", "SYM-D":"symDValue", "SYM-H":"symHValue"}
TTL = 900
_cache = OrderedDict()
_lock = threading.Lock()


def utc(value):
    parsed = datetime.fromisoformat(str(value).replace('Z','+00:00'))
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise ValueError('Observation timestamps must explicitly use UTC')
    return parsed.astimezone(timezone.utc)


def iso(value):
    return value.isoformat(timespec='seconds').replace('+00:00','Z')


def request(path, **params):
    response=requests.get(f'{BASE}/{path}',params=params,timeout=(3,7),headers={'User-Agent':'ZINGSA-scientific-dashboard/1.0'})
    response.raise_for_status()
    payload=response.json()
    if payload.get('status',{}).get('code') not in (1200,1201):
        raise RuntimeError('Kyoto HAPI reported an unsuccessful response')
    return payload


def parse(payload):
    params=payload.get('parameters',[])
    indices={p['name']:i for i,p in enumerate(params)}
    for label,name in FIELDS.items():
        if name not in indices or params[indices[name]].get('units') != 'nT':
            raise ValueError(f'Unverified Kyoto parameter: {label}')
    if 'Time' not in indices or 'versionCode' not in indices:
        raise ValueError('Kyoto time/product status metadata missing')
    rows={}
    for values in payload.get('data',[]):
        stamp=utc(values[indices['Time']])
        if stamp > datetime.now(timezone.utc):
            continue
        row={'time':iso(stamp)}
        for label,name in FIELDS.items():
            parameter=params[indices[name]]
            value=values[indices[name]]
            if value is None or str(value)==str(parameter.get('fill')):
                row[label]=None
            else:
                number=float(value)
                row[label]=number if math.isfinite(number) else None
        version=values[indices['versionCode']]
        row['version_code']=version
        row['product_status']={0:'real-time',1:'provisional',2:'final'}.get(int(version)//10,'unknown') if version is not None else 'unknown'
        row['quality']='missing' if all(row[k] is None for k in FIELDS) else 'source values; not independently validated'
        rows[row['time']]=row
    return sorted(rows.values(),key=lambda row:row['time'])


def stamp_status(payload, failed=False):
    result=copy.deepcopy(payload)
    latest=result.get('latest_observation')
    age=max(0,(datetime.now(timezone.utc)-utc(latest)).total_seconds()) if latest else None
    result['data_age_seconds']=age
    result['connection_status']='unavailable' if failed or latest is None else ('delayed' if age>600 else 'connected')
    result['refresh_seconds']=TTL
    return result


def fetch(hours=24, start=None, end=None):
    if hours not in (6,24,168):
        raise ValueError('Choose 6H, 24H or 7D')
    if bool(start)!=bool(end):
        raise ValueError('Both historical endpoints are required')
    historical=bool(start)
    if historical:
        left,right=utc(start),utc(end)
        if right<=left or right-left>timedelta(days=7):
            raise ValueError('Historical requests must span up to seven days; query longer studies in consecutive windows')
    key=(hours,start,end)
    with _lock:
        previous=_cache.get(key)
        if previous and time.monotonic()-previous[0]<TTL:
            return stamp_status(previous[1],previous[1].get('fetch_error',False))
        try:
            catalog=request('catalog')
            ids={row['id'] for row in catalog.get('catalog',[])}
            if DATASET not in ids or PROVISIONAL not in ids:
                raise ValueError('Verified ASY/SYM datasets absent from current Kyoto catalogue')
            info=request('info',id=DATASET)
            provisional=request('info',id=PROVISIONAL)
            if not historical:
                right=min(utc(info['stopDate']),datetime.now(timezone.utc))
                left=right-timedelta(hours=hours)
            data=request('data',id=DATASET,**{'time.min':iso(left),'time.max':iso(right),'format':'json'})
            rows=parse(data)
            genuine=[r for r in rows if any(r[k] is not None for k in FIELDS)]
            used_published_window=False
            if not genuine and not historical:
                # Same best-available dataset, explicitly anchor to its published
                # provisional extent. Never label this older window as current.
                right=utc(provisional['stopDate'])
                left=right-timedelta(hours=hours)
                rows=parse(request('data',id=DATASET,**{'time.min':iso(left),'time.max':iso(right),'format':'json'}))
                genuine=[r for r in rows if any(r[k] is not None for k in FIELDS)]
                used_published_window=True
            latest=max((r['time'] for r in genuine),default=None)
            result={'source':'World Data Center for Geomagnetism, Kyoto','dataset':DATASET,
                'source_url':BASE,'mode':'historical' if historical else 'live',
                'start':iso(left),'end':iso(right),'latest_observation':latest,
                'last_successful_fetch':iso(datetime.now(timezone.utc)),
                'product_status':', '.join(sorted({r['product_status'] for r in genuine})) or 'unavailable',
                'cadence_seconds':60,'rows':rows,'units':'nT',
                'publication_warning': 'No current ASY/SYM observations were returned. Showing the latest published provisional window.' if used_published_window else None,
                'fetch_error':False}
            try:
                persist(result)
                result['persistence']='archived'
            except Exception:
                result['persistence']='archive unavailable; source response retained in memory'
            _cache[key]=(time.monotonic(),result)
            _cache.move_to_end(key)
            while len(_cache)>16:
                _cache.popitem(last=False)
            return stamp_status(result)
        except Exception:
            if previous:
                retained=copy.deepcopy(previous[1])
                retained['fetch_error']=True
                retained['publication_warning']='Kyoto fetch failed. Retaining the last genuine observations and original fetch timestamp.'
                _cache[key]=(time.monotonic(),retained)
                return stamp_status(retained,True)
            raise


def persist(payload):
    """Request-driven archive in Supabase Postgres, not a worker."""
    import logging
    from zgiis.db.config import DatabaseUnavailable, database_dsn
    log = logging.getLogger(__name__)
    dsn=database_dsn()
    if not dsn:
        log.error("SUPABASE_DATABASE_URL is not configured")
        raise DatabaseUnavailable("SUPABASE_DATABASE_URL is not configured")
    from zgiis.db.config import get_conn, schema_init_enabled, transaction
    marker='%s'
    with get_conn(dsn) as conn:
        cur=conn.cursor()
        if schema_init_enabled():
            cur.execute('CREATE TABLE IF NOT EXISTS kyoto_asysym (time TIMESTAMPTZ PRIMARY KEY, asy_d DOUBLE PRECISION, asy_h DOUBLE PRECISION, sym_d DOUBLE PRECISION, sym_h DOUBLE PRECISION, version_code INTEGER, fetched_at TIMESTAMPTZ, source TEXT)')
        sql=f"INSERT INTO kyoto_asysym VALUES ({','.join([marker]*8)}) ON CONFLICT(time) DO UPDATE SET asy_d=excluded.asy_d,asy_h=excluded.asy_h,sym_d=excluded.sym_d,sym_h=excluded.sym_h,version_code=excluded.version_code,fetched_at=excluded.fetched_at"
        with transaction(conn):
            cur.executemany(sql,[(r['time'],r['ASY-D'],r['ASY-H'],r['SYM-D'],r['SYM-H'],r['version_code'],payload['last_successful_fetch'],BASE) for r in payload['rows'] if any(r[k] is not None for k in FIELDS)])
