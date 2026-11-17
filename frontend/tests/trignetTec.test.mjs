import test from "node:test";
import assert from "node:assert/strict";
import { trigNetTecReading } from "../lib/trignetTec.ts";

const now = Date.parse("2026-11-16T12:00:00Z");
const fresh = "2026-11-16T11:59:30Z";

test("raw TEC rejected by shared Zimbabwe screening does not become a map G value", () => {
  const reading = trigNetTecReading({ vtec: null, raw_code_vtec: 92.4, raw_code_vtec_time: fresh }, now);
  assert.equal(reading, null);
});
test("screened G takes priority over a raw estimate", () => {
  const reading = trigNetTecReading({ vtec: 24, vtec_time: fresh, raw_code_vtec: 90, raw_code_vtec_time: fresh }, now);
  assert.equal(reading.value, 24);
  assert.equal(reading.provisional, false);
});
test("diagnostic timestamps cannot promote raw estimates into screened G", () => {
  assert.equal(trigNetTecReading({ raw_code_vtec: 75, tec_diagnostics: { last_vtec_at: fresh } }, now), null);
});
test("stale, invalid and missing observations remain pending", () => {
  for (const row of [
    { raw_code_vtec: 80, raw_code_vtec_time: "2026-11-16T11:49:59Z" },
    { raw_code_vtec: 80 },
    { raw_code_vtec: NaN, raw_code_vtec_time: fresh },
    { raw_code_vtec: 0, raw_code_vtec_time: fresh },
    { raw_code_vtec: 250, raw_code_vtec_time: fresh },
    { raw_code_vtec: 80, raw_code_vtec_time: "2026-11-16T12:05:00Z" },
  ]) assert.equal(trigNetTecReading(row, now), null);
});
test("an expired collector snapshot cannot revive raw TEC", () => {
  assert.equal(trigNetTecReading({ raw_code_vtec: 80, raw_code_vtec_time: fresh }, now, 181), null);
});

test("screened station readings expire even while raw diagnostics are fresh", () => {
  assert.equal(trigNetTecReading({ vtec: 24, vtec_time: "2026-11-16T11:49:59Z",
    raw_code_vtec: 25, raw_code_vtec_time: fresh }, now), null);
  assert.equal(trigNetTecReading({ vtec: 24, vtec_time: fresh }, now, 181), null);
});
