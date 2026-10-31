// Requires a Chromium browser with --remote-debugging-port=9222 (Node 22+).
// Reproduces a chart resizing just before React unmounts its canvas.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const debugUrl = process.env.ZGIIS_DEBUG_URL || "http://127.0.0.1:9222";
const target = await fetch(`${debugUrl}/json/new?about:blank`, { method: "PUT" }).then(r => r.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let id = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});
function send(method, params = {}) {
  const requestId = ++id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timeout: ${method}`)); }, 10000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  const chartSource = await readFile(new URL("../frontend/node_modules/chart.js/dist/chart.umd.js", import.meta.url), "utf8");
  await evaluate(chartSource);
  const results = await evaluate(`(async () => {
    const results = [];
    for (const type of ['line', 'bar']) {
      for (const resizeDelay of [100, 0]) {
        const errors = [];
        const onError = event => { errors.push({ message: event.message, stack: event.error?.stack }); event.preventDefault(); };
        window.addEventListener('error', onError);
        for (let run = 0; run < 5; run++) {
          const wrapper = document.createElement('div');
          wrapper.style.cssText = 'width:600px;height:300px';
          const canvas = document.createElement('canvas');
          wrapper.append(canvas);
          document.body.append(wrapper);
          const chart = new Chart(canvas, {
            type,
            data: { labels: ['a', 'b'], datasets: [{ label: 'TEC', data: [1, 2] }] },
            options: { responsive: true, maintainAspectRatio: false, animation: false, resizeDelay },
          });
          chart.resize(400 + run, 200);
          chart.destroy();
          wrapper.remove();
        }
        await new Promise(resolve => setTimeout(resolve, 250));
        window.removeEventListener('error', onError);
        results.push({ type, resizeDelay, errors });
      }
    }
    return results;
  })()`);
  for (const result of results) {
    console.log(JSON.stringify({ type: result.type, resizeDelay: result.resizeDelay,
      errorCount: result.errors.length, firstError: result.errors[0]?.message }));
    if (result.resizeDelay === 100) {
      assert(result.errors.some(error => error.message.includes('ownerDocument')), "Original race must reproduce");
    } else {
      assert.equal(result.errors.length, 0, "Immediate resize must survive unmount");
    }
  }
  for (const name of ["LineChart", "BarChart"]) {
    const component = await readFile(new URL(`../frontend/components/charts/${name}.tsx`, import.meta.url), "utf8");
    assert(!/resizeDelay:\s*[1-9]/.test(component), `${name} must not schedule an update after destroy`);
  }
  console.log("Chart resize/unmount regression checks passed.");
} finally {
  await send("Page.close").catch(() => {});
  socket.close();
}
