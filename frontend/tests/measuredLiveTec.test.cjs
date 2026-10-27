const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const compiled = ts.transpileModule(
  readFileSync(path.join(__dirname, '../lib/measuredLiveTec.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', compiled)(loaded, loaded.exports);
const { measuredLiveTec } = loaded.exports;

test('accepts station-owned measured live TEC', () => {
  assert.equal(measuredLiveTec({ vtec: 18.7, source: 'live_ntrip', obs_count: 4 }), 18.7);
  assert.equal(measuredLiveTec({ vtec: 18.7, source: 'live', obs_count: 1 }), 18.7);
});

test('rejects interpolated, archived, and unobserved station values', () => {
  for (const sample of [
    { vtec: 8.7, source: 'live_surface_estimate', obs_count: 0 },
    { vtec: 8.7, source: 'processed_archive', obs_count: 3 },
    { vtec: 8.7, source: 'live_ntrip', obs_count: 0 },
    { vtec: 8.7, source: 'unknown', obs_count: 3 },
  ]) {
    assert.equal(measuredLiveTec(sample), null);
  }
});