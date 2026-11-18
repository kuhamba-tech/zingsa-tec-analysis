import test from "node:test";
import assert from "node:assert/strict";
import { magneticTecRegion, magneticRegionTecSeries } from "../lib/magneticRegionTec.ts";

const start = Date.parse("2026-11-18T00:00:00Z");
const end = start + 3600000;
const point = (minute, value) => ({ time: new Date(start + minute * 60000).toISOString(), vtec_tecu: value });

test("comparison bands have explicit non-overlapping boundaries", () => {
  for (const [dip, expected] of [[0,"equator"],[3,"equator"],[-3,"equator"],[3.01,"low"],[-9.99,"low"],
    [10,"northCrest"],[20,"northCrest"],[-10,"southCrest"],[-20,"southCrest"],
    [20.01,"mid"],[-60,"mid"],[60.01,"high"],[-90,"high"],[91,null],[NaN,null],[null,null]]) {
    assert.equal(magneticTecRegion(dip), expected);
  }
});

test("receivers have equal weight despite unequal sample rates", () => {
  const stations = [{ code:"A",name:"A",dipLatitude:15 },{ code:"B",name:"B",dipLatitude:16 }];
  const result = magneticRegionTecSeries([
    { station:"a_", points:Array.from({length:10}, (_, i) => point(i,20)) },
    { station:"b", points:[point(2,40)] },
  ], stations, start, end);
  const north = result.regions.find(r => r.id === "northCrest");
  assert.equal(north.values[0],30);
  assert.equal(north.counts[0],2);
  assert.equal(north.reporting.length,2);
  assert.deepEqual(north.values.slice(1),[null,null,null]);
});

test("hidden stations, wrong dates and rejected TEC never enter regional means", () => {
  const result = magneticRegionTecSeries([
    {station:"equator",points:[point(-1,20),point(0,0),point(1,51),point(2,NaN),point(3,25),point(60,40)]},
    {station:"hidden",points:[point(3,50)]},
  ],[{code:"equator",name:"Equator",dipLatitude:0}],start,end);
  assert.deepEqual(result.regions.find(r=>r.id==="equator").values,[25,null,null,null]);
  const high = result.regions.find(r=>r.id==="high");
  assert.deepEqual(high.members,[]);
  assert.ok(high.values.every(value=>value===null));
});

test("station membership and reporting are distinct when history is missing", () => {
  const result = magneticRegionTecSeries([], [
    {code:"mid",name:"Mid",dipLatitude:-37},
    {code:"unknown",name:"Unknown",dipLatitude:null},
  ],start,end);
  assert.equal(result.regions.find(r=>r.id==="mid").members.length,1);
  assert.equal(result.regions.find(r=>r.id==="mid").reporting.length,0);
  assert.equal(result.unknown[0].code,"unknown");
});
