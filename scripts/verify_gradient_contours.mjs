// Verify display interpolation without changing the scientific 1-degree grid.
// Run: node scripts/verify_gradient_contours.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "../frontend/node_modules/typescript/lib/typescript.js";

const source = await readFile(new URL("../frontend/lib/tecGradientContours.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const helpers = { exports: {} };
new Function("exports", "module", compiled)(helpers.exports, helpers);
const { sampleGradient, gradientContourSegments } = helpers.exports;

assert.equal(sampleGradient([[0, 2], [2, 4]], 0.5, 0.5), 2);
assert.equal(sampleGradient([[null, null], [null, null]], 0.5, 0.5), null);
assert.equal(sampleGradient([[8]], -0.25, 0.25), 8);
assert.deepEqual(gradientContourSegments([[0, 2], [0, 2]], 1), [[[0.5, 0], [0.5, 1]]]);
assert.equal(gradientContourSegments([[0, null], [0, 2]], 1).length, 0);
assert.equal(gradientContourSegments([[2, 2], [2, 2]], 1).length, 0);
assert.equal(gradientContourSegments([[2, 0], [0, 2]], 1).length, 2);
for (let y = -0.4; y < 1.5; y += 0.1) {
  for (let x = -0.4; x < 1.5; x += 0.1) {
    const value = sampleGradient([[1, 2], [3, 4]], x, y);
    if (value !== null) assert(value >= 1 - 1e-10 && value <= 4 + 1e-10);
  }
}
console.log("8 contour checks passed: interpolation, gaps, boundaries, ramps, flat fields, saddles, and no overshoot.");
