import test from "node:test";
import assert from "node:assert/strict";
import { buildNetworkMeanVtecSeries, referenceTec, nearestReading } from "../lib/stormAnalysis.ts";

const day = Date.parse("2026-11-18T00:00:00Z");
test("network mean equally weights station bins and leaves missing bins empty", () => {
  const point = (minutes, value) => ({
    time: new Date(day + minutes * 60_000).toISOString(),
    vtec_tecu: value,
  });
  const result = buildNetworkMeanVtecSeries([
    { station: "a_", points: [point(1, 10), point(2, 30), point(20, 20), point(30, 0)] },
    { station: "b", points: [point(3, 40), point(35, 51)] },
  ], day, day + 45 * 60_000);
  assert.deepEqual(result, [
    { time: day, value: 30 },
    { time: day + 15 * 60_000, value: 20 },
  ]);
});

test("reference comparison matches UTC quarter-hour across dates", () => {
  const result = referenceTec([{time:day,value:30},{time:day+900000,value:10}],
    [{time:day-86400000,value:20},{time:day-86400000+900000,value:20}]);
  assert.equal(result[0].delta,50);
  assert.equal(result[1].delta,-50);
});
test("missing or invalid reference does not create a baseline or difference", () => {
  const result = referenceTec([{time:day,value:20}], [{time:day-86400000,value:0}]);
  assert.equal(result[0].baseline,null);
  assert.equal(result[0].delta,null);
});
test("five-day reference weights each day equally and leaves incomplete bins empty", () => {
  const reference = [10, 20, 20, 25, 25].map((value, index) => ({
    time: day - (index + 1) * 86400000, value,
  }));
  reference.push({ time: reference[0].time + 60_000, value: 10 });
  const result = referenceTec([{ time: day, value: 30 }, { time: day + 900000, value: 30 }], reference, 5);
  assert.equal(result[0].baseline, 20);
  assert.equal(result[0].delta, 50);
  assert.equal(result[1].delta, null);
});
test("marker readouts reject observations too far from the selected time", () => {
  const points=[{time:day,value:20},{time:day+900000,value:null}];
  assert.equal(nearestReading(points,day+60000,120000).value,20);
  assert.equal(nearestReading(points,day+900000,120000),null);
});
