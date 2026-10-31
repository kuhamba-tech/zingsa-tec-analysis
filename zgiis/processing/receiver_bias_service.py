"""One bounded archive read shared by receiver-bias chart requests."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import threading
import time

_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="receiver-bias-chart")
_lock = threading.Lock()
_entries = {}


def chart_response(days=120):
    from zgiis.processing.receiver_bias_log import series_for_chart
    with _lock:
        now = time.monotonic()
        entry = _entries.setdefault(days, {"job":None,"data":None,"checked":None,"retry":0,"error":None})
        job = entry["job"]
        if job is not None and job.done():
            entry["job"] = None
            try:
                entry["data"] = job.result()
                entry["checked"] = datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
                entry["error"] = None
                entry["retry"] = now+60
            except Exception:
                # Connection strings and raw database errors stay out of the API.
                entry["error"] = "Receiver-bias archive temporarily unavailable. Retrying automatically."
                entry["retry"] = now+15
        if entry["job"] is None and now >= entry["retry"]:
            entry["job"] = _pool.submit(series_for_chart,days)
        data = entry["data"]
        status = "stale" if data is not None and entry["error"] else "ready" if data is not None else "unavailable" if entry["error"] else "loading"
        return {**(data or {"stations":[],"note":"No archived daily estimates are being substituted."}),
            "status":status,"checked_at":entry["checked"],
            "message":entry["error"] or ("Loading archived receiver-bias estimates…" if data is None else ""),
            "retry_after_seconds":3 if entry["job"] is not None else 15 if entry["error"] else 60}
