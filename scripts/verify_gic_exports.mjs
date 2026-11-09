// In-memory export fixtures only. This script never calls ingestion or writes to the field archive.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(root, "frontend/package.json"));
const ts = require("typescript");
const code = ts.transpileModule(fs.readFileSync(path.join(root, "frontend/lib/reportPdf.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const mod = { exports: {} };
new Function("require", "exports", "module", code)(require, mod.exports, mod);
let blob;
const originalCreate = URL.createObjectURL;
URL.createObjectURL = value => { blob = value; return "blob:test-only"; };
globalThis.document = { createElement: () => ({ click() {} }) };
const stamp = "2026-01-01T00:00:00Z";
const base = {
  station_id: "DEMA_001", period: "daily", period_label: "24-hour report", window_start: stamp,
  window_end: "2026-01-02T00:00:00Z", generated_utc: stamp, sample_count: 0, statistics: null,
  band_minutes: [], events: [], kp_correlation: null,
  coverage: { records: 0, valid_records: 0, expected_slots: null, cadence_seconds: null, missing_pct: null },
  interpretation: ["No valid field observations; this export fixture does not establish operational readiness."],
};
try {
  for (const report of [base, { ...base, interpretation: Array.from({ length: 60 }, () => "Scientific limitation: the current categories are provisional. Sensor calibration and site commissioning require verification; a model output is not a measured transformer-neutral current.") }]) {
    await mod.exports.downloadGicReportPdf(report);
    assert(blob instanceof Blob);
    const content = Buffer.from(await blob.arrayBuffer()).toString("latin1");
    assert(content.startsWith("%PDF-"));
    assert(content.includes("Data quality and coverage"));
    assert(content.includes("Scientific limitation") || content.includes("No valid field"));
    const pages = (content.match(/\/Type \/Page\b/g) ?? []).length;
    if (report.interpretation.length > 1) assert(pages > 1);
    console.log(`GIC PDF fixture passed: ${pages} page(s), ${blob.size} bytes`);
  }
} finally {
  URL.createObjectURL = originalCreate;
  delete globalThis.document;
}
