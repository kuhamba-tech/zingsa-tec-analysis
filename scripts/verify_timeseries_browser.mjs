import assert from 'node:assert/strict';
const target = await fetch('http://127.0.0.1:9224/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
let sequence=0;const pending=new Map(),errors=[],requests=new Map();
ws.addEventListener('message',({data})=>{
 const message=JSON.parse(data);
 if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);
 if(message.method==='Network.requestWillBeSent'&&/\/tec\//.test(message.params.request.url))requests.set(message.params.requestId,{url:message.params.request.url});
 if(message.method==='Network.responseReceived'&&requests.has(message.params.requestId))requests.get(message.params.requestId).status=message.params.response.status;
 if(message.method==='Network.loadingFailed'&&requests.has(message.params.requestId))requests.get(message.params.requestId).error=message.params.errorText;
 if(pending.has(message.id)){const {resolve,reject}=pending.get(message.id);pending.delete(message.id);message.error?reject(message.error):resolve(message.result);}
});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true})).result.value;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
 await send('Runtime.enable');await send('Network.enable');
 await send('Page.navigate',{url:'http://127.0.0.1:3000/time-series/'});
 for(let i=0;i<60;i++){if(await evaluate("document.body.innerText.includes('Daily VTEC')"))break;await sleep(1000);}
 console.log('API requests',JSON.stringify([...requests.values()]));
 for(const label of ['Daily Variation','Monthly Averages','Seasonal / Yearly','Diurnal Pattern']){
  await evaluate(`Array.from(document.querySelectorAll('button.tab')).find(b=>b.textContent===${JSON.stringify(label)})?.click()`);
  await sleep(1200);
  const state=await evaluate(`({canvases:[...document.querySelectorAll('main canvas')].map(c=>({width:c.width,height:c.height,painted:c.getContext('2d')?c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0):false})),errors:[...document.querySelectorAll('.banner-warn')].map(e=>e.textContent),text:document.querySelector('main')?.innerText.slice(-650)})`);
  console.log(label,JSON.stringify(state));
  assert(state.canvases.some(c=>c.width>0&&c.height>0&&c.painted),label+' did not render a chart');
 }
 assert.deepEqual(errors,[]);
}finally{await send('Page.close');ws.close();}
