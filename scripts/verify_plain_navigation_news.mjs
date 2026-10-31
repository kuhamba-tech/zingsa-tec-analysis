// Check the browser's copy of the shared public wording (no messages are sent).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "../frontend/node_modules/typescript/lib/typescript.js";

const templates = JSON.parse(await readFile(new URL("../static/data/navigation_news_plain.json", import.meta.url), "utf8"));
const source = await readFile(new URL("../frontend/lib/plainNavigationNews.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const helper = { exports: {} };
const regionalSource = await readFile(new URL("../frontend/lib/regionalNavigationNews.ts", import.meta.url), "utf8");
const regional = { exports: {} };
const times = { exports: {} };
const timesSource = await readFile(new URL("../frontend/lib/newsTimestamps.ts", import.meta.url), "utf8");
const timesCompiled = ts.transpileModule(timesSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
new Function("exports", "module", timesCompiled)(times.exports, times);
const regionalCompiled = ts.transpileModule(regionalSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
new Function("require", "exports", "module", regionalCompiled)((name) => name.includes("newsTimestamps") ? times.exports : templates, regional.exports, regional);
new Function("require", "exports", "module", compiled)((name) =>
  name.includes("regionalNavigationNews") ? regional.exports : name.includes("newsTimestamps") ? times.exports : templates, helper.exports, helper);
const { plainNavigationNews } = helper.exports;
const stamp = "2026-10-31T02:12:00Z";
const sw = { kp: 2, dst: -16, updated_utc: stamp };
let count = 0;
for (const id of Object.keys(templates.audiences)) {
  for (const tone of ["excellent", "moderate", "warning"]) {
    const result = plainNavigationNews({ id }, tone, stamp, sw);
    assert(result.socialScript.split(/\s+/).length <= 90);
    assert.equal(result.socialScript, result.broadcastScript);
    assert.equal(result.headline, templates.states[tone].headline);
    assert.equal(result.action, templates.audiences[id].action[tone]);
    assert(result.socialScript.includes("31 Oct 2026, 04:12 CAT"));
    assert(!/\b(Kp|Dst|S4|VTEC|TECU|GNSS|RTK|ROTI|RAIM|GIC)\b|≠/.test(result.socialScript));
    count++;
  }
}
for (const input of [null, {}, { ...sw, updated_utc: "invalid" }, { ...sw, updated_utc: "2026-10-30T00:00:00Z" }]) {
  const result = plainNavigationNews({ id: "citizen" }, "excellent", stamp, input);
  assert.equal(result.headline, templates.states.unknown.headline);
  assert.equal(result.statusTone, "moderate");
  count++;
}
console.log(`${count} browser-copy cases passed: shared wording, length, local dates, no jargon, and missing/stale data.`);

const fixture = JSON.parse(await readFile(new URL("../tests/fixtures/navigation_news_regional.json", import.meta.url), "utf8"));
for (const id of Object.keys(templates.audiences)) {
  const result = plainNavigationNews({ id }, "excellent", fixture.computedAt, fixture.sw, fixture);
  assert(result.summary.includes("Near Masvingo, TEC rose from 8.0 to 12.0 TEC units in 15 minutes."));
  assert(!result.summary.includes("32.0"));
  assert(result.broadcastScript.includes("When to work:"));
  assert(result.broadcastScript.includes("04:27 CAT"));
  assert(!result.broadcastScript.includes("07:00"));
  assert(result.broadcastScript.split(/\s+/).length <= 145);
}
const stale = structuredClone(fixture);
for (const point of stale.localTec[0].points) point.time = "2026-10-31T00:00:00Z";
assert(plainNavigationNews({ id: "farmer" }, "excellent", stale.computedAt, stale.sw, stale).summary.includes("No recent local TEC reading"));
const missing = structuredClone(fixture);
missing.localTec[0].points = missing.localTec[0].points.slice(-1);
assert(!plainNavigationNews({ id: "surveyor" }, "excellent", missing.computedAt, missing.sw, missing).summary.includes("rose"));
const network = structuredClone(fixture);
network.forecasts[0].feedReliability = 12;
assert(plainNavigationNews({ id: "farmer" }, "excellent", network.computedAt, network.sw, network).summary.includes("does not confirm a space-weather problem"));
console.log("9 regional cases passed: local values, trends, stale/gapped coverage, work checks, and network/TEC separation.");

const first = plainNavigationNews({ id: "farmer" }, "excellent", fixture.computedAt, fixture.sw, fixture);
const later = plainNavigationNews({ id: "farmer" }, "excellent", "2026-10-31T02:16:00Z", fixture.sw, fixture);
assert.equal(first.dataObservedAt, "2026-10-31T02:10:00.000Z");
assert.equal(later.dataObservedAt, first.dataObservedAt);
assert.notEqual(later.briefGeneratedAt, first.briefGeneratedAt);
assert(first.broadcastScript.includes("Data observed: 31 Oct 2026, 04:10 CAT · 02:10 UTC"));
assert(first.broadcastScript.includes("Brief generated: 31 Oct 2026, 04:12 CAT · 02:12 UTC"));
const unavailable = plainNavigationNews({ id: "citizen" }, "excellent", stamp, null);
assert.equal(unavailable.dataObservedAt, null);
assert(unavailable.broadcastScript.includes("Data observed: Unavailable"));
const midnight = times.exports.formatNewsTime("2026-10-31T23:30:00Z");
assert(midnight.includes("01 Nov 2026, 01:30 CAT") && midnight.includes("31 Oct 2026, 23:30 UTC"));
console.log("Timestamp checks passed: observed/generated separation, regeneration, missing observations and CAT/UTC midnight dates.");
