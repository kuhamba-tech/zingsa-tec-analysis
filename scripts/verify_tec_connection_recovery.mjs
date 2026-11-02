// Local Chromium CDP check; no posting or deployment.
import assert from "node:assert/strict";
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

let blocked=0;const proxyResponses=[];
ws.addEventListener("message",({data})=>{const m=JSON.parse(data);
 if(m.method==='Fetch.requestPaused'){blocked++;void send('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'ConnectionRefused'});}
 if(m.method==='Network.responseReceived'&&m.params.response.url.includes('/api/zgiis/live/'))proxyResponses.push({url:m.params.response.url,status:m.params.response.status});
});
try {
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
 await send('Fetch.enable',{patterns:[{urlPattern:'http://127.0.0.1:8000/live/tec-method-comparison*'},{urlPattern:'http://127.0.0.1:8000/live/vtec-by-station*'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:'http://127.0.0.1:3000/space-weather/'});
 await until(`document.readyState==='complete'`);
 await send('Page.bringToFront');
 await delay(1500);
 await ev(`document.querySelector('.sw-deferred-block')?.scrollIntoView()`);
 await delay(7000);
 await ev(`document.querySelector('#cors-network')?.scrollIntoView({block:'end'})`);
 await delay(7000);
 for(let i=0;i<8;i++){
  if(await ev(`!!document.querySelector('.home-station-vtec-plots')`))break;
  await ev(`Array.from(document.querySelectorAll('#cors-network div')).filter(n=>n.style.minHeight).forEach(n=>n.scrollIntoView({block:'center'}))`);await delay(2000);
 }
 await until(`!!document.querySelector('.home-station-vtec-plots')`);
 await until(`!!document.querySelector('.home-station-vtec-plots .station-vtec-plots-meta')`);
 assert.ok(blocked>0,'No controlled direct-port failure was exercised');
 assert.ok(proxyResponses.some(r=>r.url.includes('tec-method-comparison')&&r.status===200));
 assert.ok(proxyResponses.some(r=>r.url.includes('vtec-by-station')&&r.status===200));
 assert.equal(await ev(`document.querySelector('.home-station-vtec-plots').textContent.includes('unreachable')`),false);
 assert.equal(await ev(`!!document.querySelector('.live-tec-method-compare-status--err')`),false);
 const meta=await ev(`document.querySelector('.home-station-vtec-plots .station-vtec-plots-meta').textContent`);
 assert.deepEqual(errors,[]);
 console.log('PASS: controlled direct-port failures recovered through real same-origin proxy; comparison and station history HTTP 200; no unreachable banner or runtime exception');console.log(meta.trim());
} catch(e){console.log('Diagnostics',await ev(`({comparison:document.querySelector('.live-tec-method-compare')?.textContent.slice(-700),stations:document.querySelector('.home-station-vtec-plots')?.textContent.slice(0,1500)})`),proxyResponses,errors);throw e;}
finally{await send('Page.close');ws.close();}
