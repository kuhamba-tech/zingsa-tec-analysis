// Run against a local dev server and a Chromium browser started with
// --remote-debugging-port=9222. Uses Node's built-in WebSocket (Node 22+).
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const base = process.env.ZGIIS_TEST_URL || "http://127.0.0.1:3000";
const debuggerUrl = process.env.ZGIIS_DEBUG_URL || "http://127.0.0.1:9222";
const target = await fetch(`${debuggerUrl}/json/new?about:blank`, { method: "PUT" }).then(r => r.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});
function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout: ${method}`));
    }, 60000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(expression) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await evaluate(expression)) return;
    await delay(500);
  }
  throw new Error(`Page not ready: ${expression}`);
}
async function viewport(width) {
  await send("Emulation.setDeviceMetricsOverride", {
    width, height: 900, deviceScaleFactor: 1, mobile: width <= 768,
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: width <= 768 });
  await delay(250);
}
async function key(key, code = key, modifiers = 0) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  await delay(100);
}
const artifacts = path.join(tmpdir(), "zgiis-responsive-check");
await mkdir(artifacts, { recursive: true });
try {
  await send("Page.enable");
  for (const route of ["/", "/space-weather/", "/processing/", "/reports/"]) {
    await viewport(390);
    await send("Page.navigate", { url: base + route });
    await waitFor(`document.readyState === 'complete' && !!document.querySelector('#app-content') && !!document.querySelector('#app-navigation[inert]')`);
    await delay(1200);
    const widths = route === "/" ? [320, 390, 768, 769, 1024, 1440, 1920] : [390, 1024, 1440];
    for (const width of widths) {
      await viewport(width);
      const metrics = await evaluate(`(() => {
        const main = document.querySelector('#app-content');
        const sidebar = document.querySelector('#app-navigation');
        return {
          viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
          mainWidth: main.clientWidth, contentWidth: main.scrollWidth,
          topbar: getComputedStyle(document.querySelector('.app-topbar')).display,
          sidebarHidden: getComputedStyle(sidebar).visibility === 'hidden',
          sidebarInert: sidebar.inert,
          mainLeft: Math.round(main.getBoundingClientRect().left),
          errors: !!document.querySelector('nextjs-error-overlay'),
        };
      })()`);
      console.log(route, width, JSON.stringify(metrics));
      assert(metrics.pageWidth <= width + 1, `Page overflow on ${route} at ${width}`);
      assert(metrics.contentWidth <= metrics.mainWidth + 1, `Content overflow on ${route} at ${width}`);
      assert.equal(metrics.sidebarInert, width <= 768, "Hidden navigation focusability");
      assert.equal(metrics.topbar === "none", width > 768, "Navigation breakpoint");
      assert(!metrics.errors, "Runtime error overlay");
      if (width === 390 || width === 1440) {
        const shot = await send("Page.captureScreenshot", { format: "png" });
        const name = route.replaceAll("/", "") || "home";
        await writeFile(path.join(artifacts, `${name}-${width}.png`), Buffer.from(shot.data, "base64"));
      }
    }
    if (route !== "/") continue;
    await viewport(390);
    await evaluate(`document.querySelector('.app-hamburger').click()`);
    await waitFor(`document.querySelector('.app-hamburger').getAttribute('aria-expanded') === 'true'`);
    assert(await evaluate(`document.querySelector('#app-content').inert`), "Background must be inert");
    assert(await evaluate(`document.activeElement.classList.contains('app-mobile-close')`), "Drawer receives focus");
    await evaluate(`document.querySelector('#app-navigation a:last-of-type')?.focus();
      [...document.querySelectorAll('#app-navigation a')].at(-1).focus()`);
    await key("Tab");
    assert(await evaluate(`document.activeElement.classList.contains('app-hamburger')`), "Focus wraps inside navigation");
    await key("Escape");
    assert(await evaluate(`!document.querySelector('#app-content').inert && document.activeElement.classList.contains('app-hamburger')`), "Escape closes and restores focus");
    await evaluate(`document.querySelector('.app-hamburger').click()`);
    await viewport(1024);
    assert(await evaluate(`!document.body.classList.contains('mobile-nav-open') && !document.querySelector('#app-content').inert`), "Desktop resize unlocks page");
    await evaluate(`document.querySelector('.app-collapse-btn').click()`);
    await waitFor(`document.querySelector('#app-navigation').getBoundingClientRect().width === 56`);
    await viewport(390);
    await evaluate(`document.querySelector('.app-hamburger').click()`);
    await waitFor(`document.querySelector('.app-hamburger').getAttribute('aria-expanded') === 'true'`);
    assert(await evaluate(`getComputedStyle(document.querySelector('.app-nav-label')).display !== 'none'`), "Mobile labels survive desktop collapse");
    await key("Escape");
    await viewport(1440);
    await evaluate(`document.querySelector('.app-collapse-btn').click()`);
    await evaluate(`document.querySelector('.app-skip-link').click()`);
    assert(await evaluate(`document.activeElement.id === 'app-content'`), "Skip link focus");
    console.log("Navigation interactions passed");
  }
  console.log(`Responsive checks passed. Screenshots: ${artifacts}`);
} finally {
  await send("Page.close").catch(() => {});
  socket.close();
}
