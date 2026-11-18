import test from "node:test";
import assert from "node:assert/strict";
import { alignKpSeriesToDomain, KP_BIN_MS } from "../lib/kpTimeline.ts";

test("Kp series fill only their measured bins on the shared UTC window", () => {
  const min = Date.parse("2026-11-18T00:00:00Z");
  const max = min + 6 * 60 * 60 * 1000;
  const aligned = alignKpSeriesToDomain(
    [min, min + KP_BIN_MS, max],
    {
      observed: [2, null, 7],
      estimated: [null, 3, null],
      predicted: [null, 4, 8],
    },
    { min, max },
  );

  assert.deepEqual(aligned.epochs, [min, min + KP_BIN_MS, max]);
  assert.deepEqual(aligned.observed, [2, null, null]);
  assert.deepEqual(aligned.estimated, [null, 3, null]);
  assert.deepEqual(aligned.predicted, [null, 4, null]);
});

test("invalid or out-of-domain Kp samples stay empty", () => {
  const min = Date.parse("2026-11-18T00:00:00Z");
  const aligned = alignKpSeriesToDomain(
    [min - 1, min + KP_BIN_MS / 3, min + KP_BIN_MS],
    { observed: [5, 6, 9], estimated: [], predicted: [] },
    { min, max: min + KP_BIN_MS },
  );

  assert.deepEqual(aligned.observed, [6, null]);
  assert.deepEqual(aligned.estimated, [null, null]);
  assert.deepEqual(aligned.predicted, [null, null]);
});
