const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const compiled = ts.transpileModule(readFileSync(path.join(__dirname, '../lib/monitoringStatus.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', compiled)(loaded, loaded.exports);
const { monitoringFreshness, observationEpoch } = loaded.exports;
const now = Date.parse('2026-09-17T12:00:00Z');

test('a recent observation is live only when the refresh succeeds', () => {
  assert.equal(monitoringFreshness('2026-09-17T11:58:00Z', now, true), 'LIVE');
  assert.equal(monitoringFreshness('2026-09-17T11:58:00Z', now, true, true), 'DELAYED');
});
test('old cached, missing-time and implausibly future observations cannot appear live', () => {
  for (const time of ['2026-09-17T11:44:00Z', null, 'invalid', '2026-09-18T12:00:00Z']) {
    assert.equal(monitoringFreshness(time, now, true), 'DELAYED');
  }
});
test('unavailable measurements are never classified as live even with a fresh feed timestamp', () => {
  assert.equal(monitoringFreshness('2026-09-17T12:00:00Z', now, false), 'UNAVAILABLE');
});
test('timezone-less API observations are UTC and explicit offsets are preserved', () => {
  assert.equal(observationEpoch('2026-09-17T12:00:00'), now);
  assert.equal(observationEpoch('2026-09-17T14:00:00+02:00'), now);
});
