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
 await until(`document.readyState==='complete'`);
 await until(`(()=>{const t=Array.from(document.querySelectorAll('button')).find(t=>t.textContent==='Zimbabwe Ionospheric Response');if(t?.getAttribute('aria-selected')==='true')return true;t?.click();return false;})()`);
 await until(`Array.from(document.querySelectorAll('.matamba-figures-title')).some(t=>t.textContent==='Receiver bias by station')`);
 await ev(`Array.from(document.querySelectorAll('.matamba-figures-title')).find(t=>t.textContent==='Receiver bias by station').scrollIntoView()`);
 await until(`document.querySelectorAll('.matamba-bias-grid canvas').length>=15`);
 const result=await ev(`(()=>{const s=Array.from(document.querySelectorAll('section.matamba-figures')).find(s=>s.querySelector('.matamba-figures-title')?.textContent==='Receiver bias by station');return {charts:s?.querySelectorAll('canvas').length,error:s?.querySelector('.banner-warn')?.textContent||null}})()`);
 assert.ok(result.charts>=15);assert.equal(result.error,null);
 await send("Emulation.setDeviceMetricsOverride",{width:390,height:1000,deviceScaleFactor:1,mobile:true});await delay(400);
 assert.equal(await ev(`document.documentElement.scrollWidth<=innerWidth+1`),true);
 assert.deepEqual(errors,[]);
 console.log("PASS: real receiver-bias archive rendered",result.charts,"charts; no warning, mobile overflow or runtime exceptions");
} catch(e) {console.log("Diagnostics",await ev(`({section:Array.from(document.querySelectorAll('section.matamba-figures')).find(s=>s.querySelector('.matamba-figures-title')?.textContent==='Receiver bias by station')?.textContent,resources:performance.getEntriesByType('resource').filter(r=>r.name.includes('receiver-bias')).map(r=>({url:r.name,duration:r.duration,bytes:r.transferSize}))})`),errors);throw e;}
finally {await send("Page.close");ws.close();}
