# Station Uptime Reports: monitoring stages 1 and 2

Location: `/reports/?type=uptime&range=1w`, Recent Station Events above the map.

Run independently of the API/browser on Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_uptime_monitor.ps1
```

The supervisor restarts a failed worker. It must run on an always-on computer;
automatic launch after machine restart/logon is not installed by this change.
Other platforms can supervise `.venv/bin/python scripts/uptime_monitor.py`.

The worker uses existing `backend/.env` Spider credentials without TEC ingestion.
It polls fresh authenticated observations every 30 seconds. Three consecutive
observations confirm DOWN or recovery. First observations establish baselines only.
Incomplete responses and login/network failures pause transition confirmation.
The health badge reports communication failure or a heartbeat older than 90 seconds.
Spider online status does not certify usable RTCM/TEC observations.

New additive tables: `uptime_monitor_state`, `uptime_monitor_health`,
`uptime_incidents`, `uptime_monitor_events`. A database lease prevents concurrent
writers; state survives restarts and a unique index allows one open incident per
station. Events and snapshots also append to the existing station-status archive.
No historical records are deleted or rewritten. Existing legacy events remain in
the historical report; the new Recent Station Events table shows confirmed events
from the new worker. All stored dates are UTC; the new interface uses Africa/Harare.

Validation: isolated baseline, confirmation, restart, recovery, duplicate-worker,
communication-failure and monitoring-gap tests. No simulated records enter the live
archive. A real outage/recovery sequence still requires operational observation.

Remaining stages: technician assignments, acknowledgements, maintenance history;
time-weighted availability and MTTR; station notifications, escalation, and
common-cause detection. Existing historical report calculations and UTC displays
outside the new panel have not yet been migrated to CAT/time-weighted accounting.
