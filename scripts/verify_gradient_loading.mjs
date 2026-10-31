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

let count=0; const replies=[];
ws.addEventListener("message",({data})=>{const m=JSON.parse(data);if(m.method!=="Fetch.requestPaused")return;
 const now=new Date();count++;const ready=count>1;
 const grid=Array.from({length:8},(_,i)=>Array.from({length:10},(_,j)=>i===0?null:1+i*.1+j*.1));
 const payload={available:ready,generated_at:new Date(now.getTime()+count*1000).toISOString(),window_start:new Date(now-900000).toISOString(),window_end:now.toISOString(),lat0:-23,lon0:25,spatial:ready?grid:null,temporal:ready?grid.map(r=>r.map(v=>v==null?null:v/10)):null,temporal_available:ready,message:ready?"":"Gradient maps are being calculated in the background.",ipp_count:100,ipp_count_first_half:50,ipp_count_second_half:50};
 replies.push({count,time:Date.now()});
 void send("Fetch.fulfillRequest",{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:"application/json"},{name:"Access-Control-Allow-Origin",value:"*"}],body:Buffer.from(JSON.stringify(payload)).toString("base64")});
});
try {
 await send("Runtime.enable");await send("Page.enable");
 await send("Fetch.enable",{patterns:[{urlPattern:"*://*/tec/gradients*",requestStage:"Request"}]});
 await send("Page.addScriptToEvaluateOnNewDocument",{source:`window.__gradientRefresh=null;const nativeTimeout=window.setTimeout;window.setTimeout=function(fn,ms,...args){if(ms===30000&&fn.name==='load')window.__gradientRefresh=fn;return nativeTimeout.call(this,fn,ms,...args)}`});
 await send("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send("Page.navigate",{url:"http://127.0.0.1:3000/space-weather/"});
 await until(`document.readyState==='complete'`);
 await until(`(()=>{const t=Array.from(document.querySelectorAll('button')).find(t=>t.textContent==='Zimbabwe Ionospheric Response');if(t?.getAttribute('aria-selected')==='true')return true;t?.click();return false;})()`);
 await until(`document.querySelectorAll('.tec-gradient-hybrid .ol-viewport').length===2`);
 await ev(`window.__originalGradientViews=Array.from(document.querySelectorAll('.tec-gradient-hybrid .ol-viewport'))`);
 await until(`document.querySelector('.tec-gradient-map figcaption')?.textContent.includes('UTC')`);
 assert.ok(replies[1].time-replies[0].time<5000,JSON.stringify(replies));
 assert.equal(await ev(`window.__originalGradientViews.every((v,i)=>v===document.querySelectorAll('.tec-gradient-hybrid .ol-viewport')[i])`),true);
 for(let attempt=0;attempt<180&&count<3;attempt++) await delay(200);
 assert.ok(count>=3,"The completed maps did not refresh automatically");
 await delay(300);
 await until(`document.querySelector('.tec-gradient-map figcaption')?.textContent.includes('UTC')`);
 assert.equal(await ev(`window.__originalGradientViews.every((v,i)=>v===document.querySelectorAll('.tec-gradient-hybrid .ol-viewport')[i])`),true);
 await send("Emulation.setDeviceMetricsOverride",{width:390,height:950,deviceScaleFactor:2,mobile:true});await delay(300);
 assert.equal(await ev(`document.documentElement.scrollWidth<=innerWidth+1`),true);
 assert.deepEqual(errors,[]);
 console.log("PASS: pending-to-ready polling",replies[1].time-replies[0].time,"ms; both map viewports retained on data refresh; mobile width and runtime checks passed (controlled gradient fixture)");
} catch(e){console.log("diagnostics",await ev(`document.body.innerText.slice(-1000)`),errors);throw e;}
finally {await send("Page.close");ws.close();}
