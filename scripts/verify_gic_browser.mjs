// Read-only UI checks against the existing local app. No ingestion or configuration writes.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const target = await fetch("http://127.0.0.1:9223/json/new?about:blank", { method: "PUT" }).then(r => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once:true }); ws.addEventListener("error", reject, { once:true }); });
let sequence=0;
const pending=new Map(), errors=[];
ws.addEventListener("message", ({data}) => {
  const message=JSON.parse(data);
  if(message.method==="Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  const request=pending.get(message.id);
  if(request) { pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(message.error) : request.resolve(message.result); }
});
function send(method,params={}) { return new Promise((resolve,reject) => { const id=++sequence; const timer=setTimeout(()=>reject(new Error(method+" timeout")),30000); pending.set(id,{resolve,reject,timer}); ws.send(JSON.stringify({id,method,params})); }); }
async function evaluate(expression) { const response=await send("Runtime.evaluate", {expression,returnByValue:true,awaitPromise:true}); if(response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails)); return response.result.value; }
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(expression) { for(let i=0;i<100;i++) { if(await evaluate(expression)) return; await sleep(500); } throw new Error("UI did not become ready: "+expression); }
try {
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send("Page.navigate",{url:"http://127.0.0.1:3000/gic-monitor/"});
  await until(`document.body?.textContent.includes('Measurement readiness & station comparison')`);
  await until(`document.body?.innerText.includes('Neither station has genuine stored field observations')`);
  const text=await evaluate(`document.body.textContent`);
  assert.match(text,/Operational declaration withheld/);
  assert.match(text,/Operational prediction overlays and warnings remain disabled/);
  assert.doesNotMatch(text,/0\.03 MVAr\/A/);
  assert.match(text,/No receipt recorded/);
  assert.match(text,/Clock offset|Logger clock offset/);
  for(const width of [1440,390,320]) {
    await send("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<600});
    await sleep(300);
    const size=await evaluate(`({viewport:innerWidth,page:document.documentElement.scrollWidth})`);
    assert(size.page<=size.viewport+1,JSON.stringify(size));
    console.log("GIC responsive",JSON.stringify(size));
  }
  await send("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate(`Array.from(document.querySelectorAll('h2')).find(h=>h.textContent.includes('Measurement readiness')).scrollIntoView()`);
  const shot=await send("Page.captureScreenshot",{format:"png"});
  const filename=path.join(tmpdir(),"zingsa-gic-verification.png");
  await writeFile(filename,Buffer.from(shot.data,"base64"));
  assert.deepEqual(errors,[]);
  console.log("PASS: empty field data, commissioning limits, no GOES substitution, responsive layout, no runtime exceptions");
  console.log("Screenshot",filename);
} catch (error) {
  console.log("Browser diagnostics", await evaluate(`({url:location.href,title:document.title,text:document.body?.innerText.slice(0,1800)})`), errors);
  throw error;
} finally {
  await send("Page.close"); ws.close();
}
