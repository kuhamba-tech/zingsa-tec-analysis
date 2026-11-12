// Read-only viewport audit against an isolated Chromium debugging instance.
const target = await fetch('http://127.0.0.1:9224/json/new?about:blank', {method:'PUT'}).then(r=>r.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
let next=0; const pending=new Map();
socket.addEventListener('message',({data})=>{const msg=JSON.parse(data);if(pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);msg.error?reject(msg.error):resolve(msg.result);}});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
 for (const route of ['/space-weather/','/gic-monitor/','/reports/']) {
  await send('Page.navigate',{url:'http://127.0.0.1:3000'+route});
  await pause(6000);
  for (const width of [320,390,768,1440]) {
   await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<769});
   await pause(500);
   const {result}=await send('Runtime.evaluate',{returnByValue:true,expression:`JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>innerWidth+2&&getComputedStyle(e).position!=='fixed'&&!e.closest('canvas,.ol-viewport')}).slice(0,8).map(e=>({tag:e.tagName,class:e.className,right:Math.round(e.getBoundingClientRect().right)}))})`});
   const metrics=JSON.parse(result.value);
   if(metrics.scroll>metrics.width+1) throw new Error(`${route} overflows at ${width}px`);
   console.log(route,width,result.value);
  }
 }
} finally {await send('Page.close');socket.close();}
