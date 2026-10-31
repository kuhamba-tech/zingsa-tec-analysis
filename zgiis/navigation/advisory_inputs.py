"""Coalesced reads with a bounded public-response wait for slow upstream feeds."""
from concurrent.futures import ThreadPoolExecutor, wait
import threading
import time


class AdvisoryInputs:
    def __init__(self):
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="advisory-input")
        self.lock = threading.Lock()
        self.entries = {}

    def read(self, providers, *, timeout=2, ttl=120):
        now = time.monotonic()
        with self.lock:
            futures = {}
            for name, provider in providers.items():
                entry = self.entries.get(name)
                if entry is None or (entry[1].done() and now-entry[0] >= ttl):
                    entry = (now, self.pool.submit(provider))
                    self.entries[name] = entry
                futures[name] = entry[1]
        wait(list(futures.values()), timeout=timeout)
        values, status = {}, {}
        for name, future in futures.items():
            if not future.done():
                values[name], status[name] = None, "loading"
                continue
            try:
                values[name] = future.result()
                status[name] = "available" if values[name] else "unavailable"
            except Exception:
                values[name], status[name] = None, "unavailable"
        return values, status


advisory_inputs = AdvisoryInputs()
