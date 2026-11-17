import test from "node:test";
import assert from "node:assert/strict";
import { createTrigNetCache } from "../lib/trignetCache.ts";

test("TrigNet reuses warm results, deduplicates requests and expires readings independently of locations", async () => {
  const original = Date.now;
  let now = 1000000, calls = 0, resolve;
  Date.now = () => now;
  try {
    const cache = createTrigNetCache();
    const payload = { station_count: 1, tec_ready: 1, gg_ready: 1, collector_age_s: 20,
      stations: [{ code: "TDOU", lat: -23.08, lon: 30.38, connected: true, streaming: true,
        vtec: 25, gg_vtec: 24, gg_time: "fresh", gg_veq: 23 }] };
    const fetcher = () => { calls++; return new Promise(r => { resolve = r; }); };
    const first = cache.load(fetcher);
    assert.equal(cache.load(fetcher), first);
    resolve(payload); await first;
    await cache.load(fetcher);
    assert.equal(calls, 1);
    assert.equal(cache.peek().stations[0].vtec, 25);
    now += 80000;
    assert.equal(cache.peek().stations[0].streaming, false);
    now += 90000;
    const stale = cache.peek();
    assert.equal(stale.stations[0].code, "TDOU");
    assert.equal(stale.stations[0].vtec, null);
    assert.equal(stale.stations[0].gg_vtec, null);
    assert.equal(stale.stations[0].gg_veq, null);
    assert.equal(stale.tec_ready, 0);
    now += 86400000;
    assert.equal(cache.peek(), null);
  } finally { Date.now = original; }
});

test("a failed warmup can be retried", async () => {
  const cache = createTrigNetCache();
  await assert.rejects(cache.load(async () => { throw new Error("offline"); }));
  const payload = { stations: [], station_count: 0 };
  assert.equal(await cache.load(async () => payload), payload);
});
