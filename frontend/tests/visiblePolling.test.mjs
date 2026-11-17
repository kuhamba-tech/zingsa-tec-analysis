import test from "node:test";
import assert from "node:assert/strict";
import { startVisiblePolling } from "../lib/visiblePolling.ts";

test("visible polling pauses hidden views, avoids overlap and cleans up", async () => {
  const previous = { document: globalThis.document, setTimeout, clearTimeout };
  const timers = new Map();
  let next = 0, listener, calls = 0, finish;
  globalThis.document = {
    hidden: false,
    addEventListener: (_event, fn) => { listener = fn; },
    removeEventListener: (_event, fn) => { assert.equal(fn, listener); listener = undefined; },
  };
  globalThis.setTimeout = (fn) => { timers.set(++next, fn); return next; };
  globalThis.clearTimeout = (id) => timers.delete(id);
  const tick = async () => {
    const [id, fn] = timers.entries().next().value;
    timers.delete(id);
    fn();
    await Promise.resolve();
  };
  try {
    const stop = startVisiblePolling(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, 20000);
    await tick();
    assert.equal(calls, 1);
    assert.equal(timers.size, 0); // slow request cannot overlap another timer
    document.hidden = true; listener();
    document.hidden = false; listener();
    assert.equal(timers.size, 0); // foregrounding cannot start a duplicate request
    finish(); await Promise.resolve(); await Promise.resolve();
    assert.equal(timers.size, 1);
    document.hidden = true; listener();
    assert.equal(timers.size, 0);
    document.hidden = false; listener();
    await tick();
    assert.equal(calls, 2);
    stop(); finish(); await Promise.resolve(); await Promise.resolve();
    assert.equal(timers.size, 0);
    assert.equal(listener, undefined);
  } finally {
    globalThis.document = previous.document;
    globalThis.setTimeout = previous.setTimeout;
    globalThis.clearTimeout = previous.clearTimeout;
  }
});
