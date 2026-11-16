import test from "node:test";
import assert from "node:assert/strict";
import { trigNetTecReading } from "../lib/trignetTec.ts";

const now = Date.parse("2026-11-16T12:00:00Z");
const fresh = "2026-11-16T11:59:30Z";

test("fresh calculated raw TEC is displayed as provisional when screened G is absent", () => {
  const reading = trigNetTecReading({ vtec: null, raw_code_vtec: 92.4, raw_code_vtec_time: fresh }, now);
  assert.equal(reading.value, 92.4);
  assert.equal(reading.provisional, true);
});
test("screened G takes priority over a raw estimate", () => {
  const reading = trigNetTecReading({ vtec: 24, vtec_time: fresh, raw_code_vtec: 90, raw_code_vtec_time: fresh }, now);
  assert.equal(reading.value, 24);
  assert.equal(reading.provisional, false);
});
test("existing collector diagnostic timestamps support the deployed snapshot format", () => {
  assert.equal(trigNetTecReading({ raw_code_vtec: 75, tec_diagnostics: { last_vtec_at: fresh } }, now).value, 75);
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
