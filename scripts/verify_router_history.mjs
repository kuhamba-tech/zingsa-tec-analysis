import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const ts = require("typescript");
const module = { exports: {} };
const helper = ts.transpileModule(fs.readFileSync(new URL("../frontend/lib/routerHistory.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
new Function("module", "exports", helper)(module, module.exports);
const boot = fs.readFileSync(new URL("../frontend/public/zgiis-sw-boot.js", import.meta.url), "utf8");
for (const state of [null, {}, { __NA: false }, { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { preserved: true } }]) {
  const calls = [];
  const history = { state, replaceState: (...args) => calls.push(args) };
  globalThis.window = { history };
  assert.equal(module.exports.replaceHistoryUrl("/processing/?station=DEMA#converter"), state?.__NA === true);
  if (state?.__NA === true) {
    assert.equal(calls[0][0], state);
    assert.equal(calls[0][2], "/processing/?station=DEMA#converter");
  } else assert.equal(calls.length, 0, "No history write before App Router initialization");
  delete globalThis.window;

  const bootCalls = [], timers = [];
  const location = new URL("https://example.com/gic-monitor/?_chunk=123&station=DEMA#observations");
  const context = {
    URL, Date, Event, location, navigator: { userAgent: "" },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: (callback, ms) => { timers.push({ callback, ms }); return timers.length; },
    clearTimeout() {}, fetch: async () => ({ ok: false }),
  };
  context.window = { location, history: { state, replaceState: (...args) => bootCalls.push(args) }, addEventListener() {}, setTimeout: context.setTimeout };
  vm.runInNewContext(boot, context);
  const cleanup = timers.find(timer => timer.ms === 12000);
  assert(cleanup, "Real early-boot URL cleanup timer is installed");
  cleanup.callback();
  if (state?.__NA === true) {
    assert.equal(bootCalls.length, 1);
    assert.equal(bootCalls[0][0], state);
    assert.equal(bootCalls[0][2], "/gic-monitor/?station=DEMA#observations");
  } else assert.equal(bootCalls.length, 0, "Early boot never requests a router restore without initialized state");
}
console.log("PASS: startup URL cleanup and processing hash updates preserve Next history; no history action before initialization (8 cases)");
