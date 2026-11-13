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
 await send('Page.navigate',{url:'http://127.0.0.1:3000/processing/'});
 await wait(12000);
 await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='RINEX Data')?.click()`);
 let state;
 for(let i=0;i<40;i++){
  state=await evaluate(`({retry:document.body.innerText.includes('Retry archive status'),configured:document.body.innerText.includes('Point RINEX_ARCHIVE_ROOT'),unreachable:document.body.innerText.includes('Could not reach RINEX archive status endpoint'),map:document.body.innerText.includes('Zimbabwe CORS Network')})`);
  if(state.configured||state.unreachable)break;
  await wait(1000);
 }
 console.log(JSON.stringify(state));
 assert(state.map,'RINEX station map not shown');
 assert(state.configured,'Archive configuration message not shown');
 assert.equal(state.unreachable,false,'Archive status request failed');
 assert.deepEqual(errors,[]);
}finally{await send('Page.close');socket.close();}
