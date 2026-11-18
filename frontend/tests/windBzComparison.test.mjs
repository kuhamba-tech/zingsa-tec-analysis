import test from "node:test";
import assert from "node:assert/strict";
import { windBzComparison, solarWindPressure } from "../lib/windBzComparison.ts";

const start = Date.parse("2026-11-18T00:00:00Z");
const stamp = minutes => new Date(start + minutes * 60000).toISOString();

test("dynamic pressure uses simultaneous measured density and speed", () => {
  const values = solarWindPressure([400,400,400,null,-9999,400], [5,null,-1,5,5,0]);
  assert.ok(Math.abs(values[0]-1.33808)<1e-8);
  assert.deepEqual(values.slice(1),[null,null,null,null,0]);
});

test("wind and Bz align by real UTC minute without filling gaps", () => {
  const result = windBzComparison(
    {times:[stamp(0),stamp(2)],values:[400,420],density:[5,7],temperature:[30000,50000]},
    {times:[stamp(1),stamp(2)],values:[-5,0]},start,start+120000);
  assert.deepEqual(result.speed,[400,null,420]);
  assert.deepEqual(result.density,[5,null,7]);
  assert.deepEqual(result.temperature,[30000,null,50000]);
  assert.deepEqual(result.bz,[null,-5,0]);
});

test("source timestamps cannot be stretched into a different UTC day", () => {
  const result = windBzComparison(
    {times:[stamp(-1),stamp(0),stamp(1)],values:[500,-9999,NaN]},
    {times:[stamp(0),stamp(0.5),stamp(3)],values:[-4,2,10]},start,start+60000);
  assert.deepEqual(result.speed,[null,null]);
  assert.deepEqual(result.bz,[-1,null]);
});
