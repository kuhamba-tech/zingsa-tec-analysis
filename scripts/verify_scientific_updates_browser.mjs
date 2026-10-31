// Local Chromium CDP check; no posting or deployment.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const target=await fetch("http://127.0.0.1:9222/json/new?about:blank",{method:"PUT"}).then(r=>r.json());
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener("open",r,{once:true}));
let id=0;const requests=new Map();const errors=[];
ws.addEventListener("message",({data})=>{
  const m=JSON.parse(data);
  if(m.method==="Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text);
  const p=requests.get(m.id);if(p){requests.delete(m.id);clearTimeout(p.timer);m.error?p.reject(m.error):p.resolve(m.result);}
});
function send(method,params={}){return new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>reject(new Error(method+" timed out")),60000);requests.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));});}
async function ev(expression){const r=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(expression){for(let i=0;i<100;i++){if(await ev(expression))return;await delay(500);}throw new Error("Not ready: "+expression);}
try {
  await send("Runtime.enable");await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send("Page.navigate",{url:"http://127.0.0.1:3000/space-weather/"});
  await until(`Array.from(document.querySelectorAll('[role=tab]')).some(t=>t.textContent==='Solar Activity')`);
  await until(`document.readyState==='complete'`);
  await until(`(()=>{const t=Array.from(document.querySelectorAll('[role=tab]')).find(t=>t.textContent==='Solar Activity'); if(t?.getAttribute('aria-selected')==='true')return true;t?.click();return false;})()`);
  await until(`!!document.querySelector('#scientific-updates-title')`);
  await until(`document.querySelectorAll('[aria-label="Official forecast discussion"] details').length===4`);
  assert.equal(await ev(`document.querySelectorAll('[aria-label="Official forecast discussion"] details').length`),4);
  const text=await ev(`document.querySelector('#scientific-updates-title').closest('section').textContent`);
  assert.match(text,/Observed · NOAA 24-hour summary/);
  assert.match(text,/Forecast · NOAA guidance/);
  assert.match(text,/Issued:/);assert.match(text,/Retrieved:/);assert.match(text,/Sample:/);
  assert.match(text,/does not supply a validated local RTK working window/);
  assert.equal(await ev(`!!document.querySelector('a[href="https://solarham.com/news_current_month.htm"]')`),true);
  for(const width of [1440,390,320]){
    await send("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<600});await delay(250);
    const size=await ev(`({viewport:innerWidth,page:document.documentElement.scrollWidth})`);
    assert.ok(size.page<=size.viewport+1,JSON.stringify(size));console.log("responsive",size);
  }
  await ev(`document.querySelector('#scientific-updates-title').scrollIntoView()`);
  const shot=await send("Page.captureScreenshot",{format:"png"});
  const screenshotPath=path.join(tmpdir(),"zingsa-scientific-updates-mobile.png");
  await writeFile(screenshotPath,Buffer.from(shot.data,"base64"));
  assert.deepEqual(errors,[]);
  console.log("PASS: scientist tab, live official discussion, source links, observation/forecast separation, mobile widths, no runtime exceptions");
  console.log("Screenshot",screenshotPath);
} catch(e) {
  console.log("Diagnostics",await ev(`({text:document.body.innerText.slice(-1600)})`),errors);throw e;
} finally {await send("Page.close");ws.close();}
