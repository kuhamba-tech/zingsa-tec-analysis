import assert from 'node:assert/strict';
const target = await fetch('http://127.0.0.1:9224/json/new?about:blank', {method:'PUT'}).then(r=>r.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
let sequence=0;
const pending=new Map(), errors=[];
socket.addEventListener('message',({data})=>{
  const message=JSON.parse(data);
  if(message.method==='Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  const call=pending.get(message.id);
  if(call){pending.delete(message.id);message.error?call.reject(message.error):call.resolve(message.result);}
});
const send=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));
});
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true})).result.value;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
 await send('Runtime.enable');
 await send('Page.navigate',{url:'http://127.0.0.1:3000/prn-explorer/'});
 for(let i=0;i<60;i++){
  const loaded=await evaluate(`document.body.innerText.includes('Live NTRIP pipeline') && !document.body.innerText.includes('Loading PRN data')`);
  if(loaded)break;await wait(1000);
 }
 const initial=await evaluate(`({source:document.body.innerText.includes('Live NTRIP pipeline'),charts:document.querySelectorAll('main canvas').length})`);
 console.log('Initial',JSON.stringify(initial));assert(initial.source);
 for(const label of ['Sky Plot','Elevation vs TEC','Quality Analysis','GNSS Disturbance','VTEC by PRN']){
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)})?.click()`);
  await wait(1100);
  const state=await evaluate(`({charts:document.querySelectorAll('main canvas').length,skyMessage:document.body.innerText.includes('Select one station and refresh'),errors:[...document.querySelectorAll('.banner-alert')].map(e=>e.textContent)})`);
  console.log(label,JSON.stringify(state));
  if(label==='Sky Plot')assert(state.skyMessage);else assert(state.charts>0,label+' has no rendered graph');
 }
 assert.deepEqual(errors,[]);
}finally{await send('Page.close');socket.close();}
