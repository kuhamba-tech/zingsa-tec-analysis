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
  if(m.method==="Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  const p=requests.get(m.id);if(p){requests.delete(m.id);clearTimeout(p.timer);m.error?p.reject(m.error):p.resolve(m.result);}
});
function send(method,params={}){return new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>reject(new Error(method+" timed out")),60000);requests.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));});}
async function ev(expression){const r=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(expression){for(let i=0;i<100;i++){if(await ev(expression))return;await delay(500);}throw new Error("Not ready: "+expression);}

async function inspect(base) {
 await send("Page.navigate",{url:base+"/space-weather/gnss-intelligence/"});
 await until(`document.querySelectorAll('.gnwi-news-card').length===6`);
 return ev(`(()=>{const p=document.querySelector('.gnwi-page'),h=document.querySelector('.gnwi-hero h1'),c=document.querySelector('.gnwi-news-card');return {title:h.textContent,kicker:document.querySelector('.gnwi-hero-kicker').textContent,sections:Array.from(p.querySelectorAll('h2,h3')).map(n=>n.textContent),cards:Array.from(document.querySelectorAll('.gnwi-news-title')).map(n=>n.textContent),font:getComputedStyle(h).fontSize,subtitle:getComputedStyle(document.querySelector('.gnwi-hero .page-subtitle')).fontSize,width:Math.round(p.getBoundingClientRect().width),cardPadding:getComputedStyle(c).padding,hasNational:!!p.querySelector('.gnss-status-card'),hasRegionSelector:!!p.querySelector('.gnwi-news-location'),hasWorkingAdvisor:!!p.querySelector('.gnwi-advisory-overview')}})()`);
}
try {
 await send("Runtime.enable");await send("Page.enable");await send("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 const live=await inspect("https://zingsa-gnss-tec.vercel.app");
 errors.length=0;
 const local=await inspect("http://127.0.0.1:3000");
 assert.equal(local.title,live.title);assert.deepEqual(local.sections,live.sections);assert.deepEqual(local.cards,live.cards);
 for(const key of ["font","subtitle","width","cardPadding"]) assert.equal(local[key],live[key],key);
 assert.equal(local.hasRegionSelector,live.hasRegionSelector);assert.equal(local.hasWorkingAdvisor,live.hasWorkingAdvisor);
 assert.equal(await ev(`document.querySelectorAll('.gnwi-news-card .gnwi-sw-box').length`),6);
 assert.equal(await ev(`document.querySelectorAll('.gnwi-news-card .gnwi-news-timestamps').length`),6);
 assert.equal(await ev(`document.querySelectorAll('.gnwi-news-card .gnwi-news-impact-label').length`),6);
 console.log("Verified live/local: matching headings, dimensions, six detailed cards, purple space-weather panels, observation/generation times and impact sections.");
 for(const width of [390,320]){await send("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:true});await delay(400);assert.equal(await ev(`document.documentElement.scrollWidth<=innerWidth+1`),true);}
 await send("Emulation.setDeviceMetricsOverride",{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
 await ev(`document.querySelector('.gnwi-news-grid').scrollIntoView()`); await delay(400);
 const shot=await send("Page.captureScreenshot",{format:"png"});const screenshotPath=path.join(tmpdir(),"zingsa-local-restored-navigation-news.png");await writeFile(screenshotPath,Buffer.from(shot.data,"base64"));console.log("Local screenshot",screenshotPath);
 assert.deepEqual(errors,[]);console.log("PASS: local Navigation Weather matches live headings, six audience cards and page structure; mobile and runtime checks passed");
} catch(e){console.log("Diagnostics",await ev(`document.body.innerText.slice(-1000)`),errors);throw e;}
finally {await send("Page.close");ws.close();}
