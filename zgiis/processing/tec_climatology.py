"""Climatology of measured CORS TEC. No forecast or spatial interpolation."""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
import pandas as pd

from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
from zgiis.processing.north_south_tec_research import zimbabwe_lat_band

VERSION = "tec-climatology-1"
SEASONS = {"March equinox": [2, 3, 4], "June solstice": [5, 6, 7],
           "September equinox": [8, 9, 10], "December solstice": [11, 12, 1]}


def magnetic_latitude(lat, lon, epoch):
    """IGRF-14 centered-dipole latitude, degree 1, 2025–2030 only.

    NOAA https://www.ngdc.noaa.gov/IAGA/vmod/coeffs/igrf14coeffs.txt
    Geodetic latitude converted to geocentric on WGS84 at ground level.
    This is not quasi-dipole/apex latitude or a traced field-line coordinate.
    """
    if not 2025 <= epoch <= 2030:
        return None
    dt = epoch - 2025
    g10, g11, h11 = -29350 + 12.6 * dt, -1410.3 + 10 * dt, 4545.5 - 21.5 * dt
    phi = math.atan((1 - 6.69437999014e-3) * math.tan(math.radians(lat)))
    lam = math.radians(lon)
    dot = -(g11 * math.cos(phi) * math.cos(lam) + h11 * math.cos(phi) * math.sin(lam) + g10 * math.sin(phi))
    return round(math.degrees(math.asin(dot / math.sqrt(g10*g10 + g11*g11 + h11*h11))), 4)


def geomagnetic_equator_latitude(lon, epoch):
    """Geographic latitude of the IGRF-14 centered-dipole equator (mlat = 0).

    Inverse of magnetic_latitude. Not the dip equator.
    """
    if not 2025 <= epoch <= 2030:
        return None
    dt = epoch - 2025
    g10, g11, h11 = -29350 + 12.6 * dt, -1410.3 + 10 * dt, 4545.5 - 21.5 * dt
    lam = math.radians(lon)
    tan_phi = -(g11 * math.cos(lam) + h11 * math.sin(lam)) / g10
    tan_lat = tan_phi / (1 - 6.69437999014e-3)
    return round(math.degrees(math.atan(tan_lat)), 4)


def season_key(month, year, groups=None):
    groups = groups or SEASONS
    for name, months in groups.items():
        if month in months:
            # Label a wrapping season by the year containing its final month.
            wraps = any(a > b for a, b in zip(months, months[1:]))
            return name, year + (1 if wraps and month >= months[0] else 0)
    raise ValueError("Every month must belong to a season")


def read_bins(db, start, end, minutes):
    marker = "%s" if db._is_pg else "?"
    epoch = "EXTRACT(EPOCH FROM time)" if db._is_pg else "CAST(strftime('%s', time) AS INTEGER)"
    bucket = f"CAST(FLOOR({epoch} / {int(minutes)*60}) AS BIGINT) * {int(minutes)*60}"
    # Old records may predate the idempotency migration. De-duplicate their
    # scientific identity in the query without deleting historical records.
    sql = f"""SELECT station, {bucket} AS bucket, AVG(vtec_tecu) AS vtec,
                     COUNT(*) AS observations
        FROM (SELECT time, station, constellation, prn, tec_method, AVG(vtec_tecu) AS vtec_tecu
              FROM vtec_obs WHERE time >= {marker} AND time < {marker}
              AND tec_method LIKE {marker} AND vtec_tecu > 0 AND vtec_tecu < 200
              GROUP BY time, station, constellation, prn, tec_method) AS measured
        GROUP BY station, {bucket} ORDER BY bucket, station"""
    return db._read_sql(sql, [start.isoformat(), end.isoformat(), "%code_live%"])


def summarize(frame, key, expected, station_codes):
    """Equal station weights, after equal-weight occupied time bins per station."""
    result = []
    if frame.empty:
        return result
    for (period, region), rows in frame.groupby([key, "region"], sort=True):
        station = rows.groupby("station").vtec.mean()
        quantiles = station.quantile([0, .25, .5, .75, 1])
        denominator = expected(str(period)) * len(station_codes[region])
        result.append(dict(period=str(period), region=region,
            mean=float(station.mean()), median=float(station.median()),
            minimum=float(quantiles.loc[0]), q1=float(quantiles.loc[.25]),
            q3=float(quantiles.loc[.75]), maximum=float(quantiles.loc[1]),
            stations=len(station), station_ids=sorted(station.index.tolist()),
            observations=int(rows.observations.sum()), occupied_bins=len(rows),
            expected_bins=denominator,
            completeness_pct=round(100*len(rows)/denominator, 2) if denominator else 0))
    return result


def build(db, start_date, end_date, tz="CAT", minutes=60, regions=None, stations=None, seasons=None):
    offset = timedelta(hours=2 if tz == "CAT" else 0)
    start = datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc) - offset
    end = datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc) + timedelta(days=1) - offset
    if end <= start or (end-start).days > 1100:
        raise ValueError("Select an ordered date range of at most three years")
    if minutes not in (15, 30, 60):
        raise ValueError("Resolution must be 15, 30 or 60 minutes")
    if seasons:
        months = [m for group in seasons.values() for m in group]
        if sorted(months) != list(range(1,13)) or len(seasons) != 4:
            raise ValueError("Four seasonal groups must cover each month exactly once")
    now = datetime.now(timezone.utc)
    midpoint = start + (end-start)/2
    epoch = midpoint.year + (midpoint-datetime(midpoint.year,1,1,tzinfo=timezone.utc)).total_seconds()/(365.25*86400)
    catalog = [dict(code=s.code.lower().rstrip("_"), name=s.name, latitude=s.lat, longitude=s.lon,
                    region=zimbabwe_lat_band(s.lat), magnetic_latitude=magnetic_latitude(s.lat,s.lon,epoch))
               for s in ZIMBABWE_CORS_STATIONS]
    selected = [s for s in catalog if (not regions or s['region'] in regions) and (not stations or s['code'] in stations)]
    codes = {region:[s['code'] for s in selected if s['region']==region] for region in ('northern','central','southern')}
    mapping = {s['code']:s['region'] for s in selected}
    # Future intervals are missing rather than forecast substitutes.
    frame = read_bins(db, start, min(end, now), minutes)
    frame['station'] = frame.station.astype(str).str.lower().str.rstrip('_')
    frame = frame[frame.station.isin(mapping)].copy()
    frame['region'] = frame.station.map(mapping)
    local = pd.to_datetime(frame.bucket, unit='s', utc=True) + offset
    frame['day'] = local.dt.strftime('%Y-%m-%d')
    frame['month'] = local.dt.strftime('%Y-%m')
    frame['hour'] = local.dt.hour.astype(str).str.zfill(2)
    frame['month_hour'] = frame.month + ' ' + frame.hour
    frame['day_hour'] = frame.day + ' ' + frame.hour
    frame['daynight'] = pd.Series(['Day (06–18)' if 6 <= h < 18 else 'Night (18–06)' for h in local.dt.hour], index=frame.index, dtype=str)
    sk = [season_key(t.month,t.year,seasons) for t in local]
    frame['season'] = pd.Series([f'{year} {name}' for name,year in sk], index=frame.index, dtype=str)
    frame['season_hour'] = frame.season + ' ' + frame.hour
    frame['season_daynight'] = frame.season + ' ' + frame.daynight
    grid = pd.date_range(start, end, freq=f'{minutes}min', inclusive='left') + offset
    denominators = pd.DataFrame({'day':grid.strftime('%Y-%m-%d'), 'month':grid.strftime('%Y-%m'),
        'hour':grid.strftime('%H')})
    denominators['month_hour'] = denominators.month+' '+denominators.hour
    denominators['day_hour'] = denominators.day+' '+denominators.hour
    denominators['daynight'] = ['Day (06–18)' if 6<=h<18 else 'Night (18–06)' for h in grid.hour]
    denominators['season'] = [f'{y} {n}' for n,y in (season_key(t.month,t.year,seasons) for t in grid)]
    denominators['season_hour'] = denominators.season+' '+denominators.hour
    denominators['season_daynight'] = denominators.season+' '+denominators.daynight
    tables={}
    for key in denominators.columns:
        expected=denominators[key].value_counts().to_dict()
        tables[key]=summarize(frame,key,lambda p: int(expected.get(p,0)),codes)
    station_table=[]
    for s in selected:
        rows=frame[frame.station==s['code']]
        station_table.append({**s,'mean':float(rows.vtec.mean()) if len(rows) else None,
            'observations':int(rows.observations.sum()),'occupied_bins':len(rows),
            'completeness_pct':round(100*len(rows)/len(grid),2),
            'hourly':[{'hour':int(h),'mean':float(g.vtec.mean()),'observations':int(g.observations.sum())} for h,g in rows.groupby('hour')],
            'monthly':[{'month':str(m),'mean':float(g.vtec.mean()),'observations':int(g.observations.sum())} for m,g in rows.groupby('month')],
            'last_observation_bin_utc':datetime.fromtimestamp(float(rows.bucket.max()),timezone.utc).isoformat() if len(rows) else None})
    # Match exactly the same occupied time bins for regional differences.
    pivot=frame.groupby(['bucket','region']).vtec.mean().unstack('region') if len(frame) else pd.DataFrame()
    differences=[]
    for a,b in [('northern','central'),('central','southern'),('northern','southern')]:
        if a in pivot and b in pivot:
            matched=pivot[[a,b]].dropna()
            for bucket,row in matched.iterrows():
                date=datetime.fromtimestamp(float(bucket),timezone.utc)+offset
                name,year=season_key(date.month,date.year,seasons)
                differences.append({'pair':f'{a} − {b}','time':date.isoformat(),'hour':date.hour,'season':f'{year} {name}','delta_tecu':float(row[a]-row[b])})
    station_pivot = frame.pivot(index='bucket',columns='station',values='vtec') if len(frame) else pd.DataFrame()
    common = station_pivot.dropna()
    latitude_stations = [{**s, 'matched_mean':float(common[s['code']].mean()), 'matched_bins':len(common)}
        for s in selected if len(common) and s['code'] in common]
    gradients=[]
    for north in selected:
        for south in selected:
            if north['latitude']-south['latitude'] < .15 or abs(north['longitude']-south['longitude']) > 1:
                continue
            a,b=north['code'],south['code']
            if a not in station_pivot or b not in station_pivot:
                continue
            paired=station_pivot[[a,b]].dropna()
            if paired.empty:
                continue
            p1,p2=map(math.radians,[north['latitude'],south['latitude']])
            dl=math.radians(north['longitude']-south['longitude'])
            distance=6371*2*math.asin(math.sqrt(math.sin((p1-p2)/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2))
            delta=float((paired[a]-paired[b]).mean())
            gradients.append({'north':a,'south':b,'matched_bins':len(paired),'distance_km':distance,
                'longitude_difference_deg':abs(north['longitude']-south['longitude']),
                'delta_tecu':delta,'tecu_per_100_km':100*delta/distance})
    meta=db._read_sql("SELECT MIN(time) AS earliest, MAX(time) AS latest, MAX(stored_at) AS last_stored, MAX(received_at) AS last_received FROM vtec_obs WHERE tec_method LIKE " + ("%s" if db._is_pg else "?"),['%code_live%']).iloc[0].to_dict()
    marker = '%s' if db._is_pg else '?'
    active=db._read_sql(f"SELECT COUNT(DISTINCT station) AS n FROM vtec_obs WHERE time >= {marker} AND time <= {marker} AND tec_method LIKE {marker} AND vtec_tecu > 0 AND vtec_tecu < 200",[(now-timedelta(minutes=15)).isoformat(),now.isoformat(),'%code_live%']).iloc[0]['n']
    meta['active_stations_15min']=int(active)
    newest=pd.to_datetime(meta['latest'],utc=True) if meta.get('latest') else None
    meta['state']='recent measurements' if newest is not None and (now-newest).total_seconds() <= 120 else 'stale or unavailable'
    if meta.get('last_stored') and meta.get('last_received'):
        meta['latest_batch_delay_s']=max(0,round((pd.to_datetime(meta['last_stored'],utc=True)-pd.to_datetime(meta['last_received'],utc=True)).total_seconds(),1))
    return {'version':VERSION,'start':start_date,'end':end_date,'timezone':tz,'resolution_minutes':minutes,
        'catalog':catalog,'stations':station_table,'tables':tables,'differences':differences,
        'latitude_stations':latitude_stations,'gradients':gradients,
        'expected_periods':{k:sorted(denominators[k].unique().tolist()) for k in denominators},
        'capture':{k:str(v) if v is not None and pd.notna(v) else None for k,v in meta.items()},
        'observations':int(frame.observations.sum()), 'contributing_stations':int(frame.station.nunique()),
        'geomagnetic_model':f'IGRF-14 centered dipole, epoch {epoch:.3f}; ground station coordinates; not quasi-dipole',
        'source':'Measured NTRIP code_live only; station time-bin means; uncalibrated code TEC may contain receiver/satellite biases',
        'seasons':seasons or SEASONS,
        'methods':[
            'Fixed existing map boundaries: North > −18.2°, Central > −20.2°, otherwise South.',
            'Average satellites in each station/time bin; average occupied bins per station; give each contributing station equal regional weight.',
            'Medians and boxes describe the distribution of station summaries, not pooled satellite observations.',
            'Completeness = occupied station/time bins divided by all selected station/time bins, including future and missing periods.',
            'Dates are inclusive in the selected time zone. CAT is UTC+2; missing bins are never interpolated.',
            'December seasons are labelled by January’s year. Statistics use only the selected date range; partial years and seasons remain partial.',
            'Day/night uses fixed 06:00–18:00 clock hours, not astronomical sunrise/sunset.',
            'Regional differences use matching time bins and are not physical gradients. Geomagnetic latitude uses documented IGRF-14 degree-1 coefficients (valid 2025–2030).',
            'Latitude scatter uses bins shared by all contributing stations. Pair gradients require ≥0.15° latitude separation and ≤1° longitude difference; matched-bin difference divided by great-circle separation, TECU/100 km, is a pairwise along-baseline estimate.',
            'Historical received-at times and IPP coordinates were not stored; they are unavailable, not reconstructed. Stored-at is available only after the migration.',
            'Quiet/disturbed filtering is unavailable until verified historical geomagnetic indices are time-matched.'
        ]}
