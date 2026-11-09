// Local-only browser check. Does not send messages or deploy.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const target = await fetch("http://127.0.0.1:9222/json/new?about:blank", {method:"PUT"}).then(r=>r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener("open",r,{once:true}));
let seq=0; const pending=new Map(); const errors=[];
ws.addEventListener("message",({data})=>{const m=JSON.parse(data); if(m.method==="Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text); const p=pending.get(m.id); if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(m.error):p.resolve(m.result);}});
function send(method,params={}) {return new Promise((resolve,reject)=>{const id=++seq; const timer=setTimeout(()=>reject(new Error(method+" timeout")),60000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function ev(expression){const r=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(expression){for(let i=0;i<100;i++){if(await ev(expression))return;await delay(500);}throw new Error("Not ready: "+expression);}
try {
 await send("Runtime.enable"); await send("Page.enable");
 await send("Page.addScriptToEvaluateOnNewDocument",{source:`window.__advisoryTimers=[];const oldInterval=window.setInterval;window.setInterval=function(fn,ms,...args){if(ms===120000)window.__advisoryTimers.push(fn);return oldInterval.call(this,fn,ms,...args)};`});
 await send("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send("Page.navigate",{url:"http://127.0.0.1:3000/space-weather/gnss-intelligence/"});
 await until(`!!document.querySelector('.gnss-status-card')`);
 assert.match(await ev(`document.querySelector('.gnwi-hero h1').textContent`),/Navigation Weather/);
 assert.equal(await ev(`document.querySelector('.gnss-status-card').closest('details')===null`),true);
 await until(`!!document.querySelector('.gnwi-advisory-overview')`);
 await ev(`(()=>{const s=document.querySelector('.gnwi-news-location select');if(s.value!=='HARARE'){s.value='HARARE';s.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
 await until(`document.querySelectorAll('.gnwi-advisory-overview').length===1 && document.querySelector('.gnwi-advisory-overview h3')?.textContent.includes('Harare')`);
 assert.equal(await ev(`document.querySelectorAll('.gnwi-window-table tbody tr').length`),5);
 const first = await ev(`document.querySelector('.gnwi-news-grid').querySelectorAll('article').length`);
 assert.equal(first,3);
 const draft = await ev(`document.querySelector('.gnwi-news-script').textContent`);
 assert.match(draft,/Data observed:/);assert.match(draft,/Brief generated:/);assert.match(draft,/https:\/\/zingsa-gnss-tec.vercel.app\//);
 assert.match(draft,/Pending/);
 assert.match(await ev(`document.querySelector('.gnwi-advisory-overview').textContent`),/not verified/i);
 const link=await ev(`document.querySelector('a[href^="https://wa.me/"]').href`);
 assert.equal(new URL(link).searchParams.get("text"),draft);
 await send("Emulation.setFocusEmulationEnabled",{enabled:true});
 await ev(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedAdvisory=text}}})`);
 await ev(`document.querySelector('.gnwi-news-card .gnwi-copy-btn').click()`);
 await until(`typeof window.__copiedAdvisory==='string'`);
 assert.equal(await ev(`window.__copiedAdvisory`),draft);
 for(const width of [1440,390,320]){
   await send("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<600});await delay(300);
   const metrics=await ev(`({viewport:innerWidth,page:document.documentElement.scrollWidth})`);
   assert.ok(metrics.page<=metrics.viewport+1,JSON.stringify(metrics));
   console.log("responsive",metrics);
 }
 // Change location through the native select; old assessment must not be reused.
 await ev(`(()=>{const s=document.querySelector('.gnwi-news-location select');s.value='MASVINGO';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await until(`document.querySelector('.gnwi-advisory-overview h3')?.textContent.includes('Masvingo')`);
 assert.match(await ev(`document.querySelector('.gnwi-news-script').textContent`),/Masvingo/);
 await ev(`(()=>{const s=document.querySelector('.gnwi-news-location input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(s,'2026-11-02');s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await until(`document.querySelector('.gnwi-advisory-overview')?.textContent.includes('2026-11-02')`);
 assert.equal(await ev(`Array.from(document.querySelectorAll('.gnwi-window-table tbody tr')).every(r=>r.textContent.toLowerCase().includes('pending'))`),true);
 // Exercise the automatic refresh callback without waiting two minutes.
 await ev(`Promise.all(window.__advisoryTimers.slice(-1).map(fn=>fn()))`);
 await until(`!!document.querySelector('.gnwi-advisory-overview')`);
 await ev(`document.querySelector('.gnwi-advisory-overview').scrollIntoView()`);
 const screenshot=await send("Page.captureScreenshot",{format:"png"});
 const screenshotPath=path.join(tmpdir(),"zingsa-navigation-advisories-mobile.png");
 await writeFile(screenshotPath,Buffer.from(screenshot.data,"base64"));
 console.log("Screenshot",screenshotPath);
 assert.deepEqual(errors,[]);
 console.log("PASS: canonical news, five windows, primary cards, share draft, location, polling, mobile and runtime checks");
} catch(error) { console.log("Page diagnostics", await ev(`({url:location.href,text:document.body.innerText.slice(0,3500),requests:performance.getEntriesByType("resource").filter(r=>r.name.includes("navigation-news")).map(r=>r.name)})`), errors); throw error; } finally {await send("Page.close");ws.close();}
