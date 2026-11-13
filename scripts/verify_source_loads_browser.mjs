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
try{
  await send('Runtime.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:3000/time-series/'});
  await wait(12000);
  const changed=await evaluate(`(()=>{
    const card=[...document.querySelectorAll('.omni-range-card')].find(c=>c.textContent.includes('Thermosphere O/N2'));
    if(!card)return false;
    const selects=card.querySelectorAll('select');
    const set=(element,value)=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('change',{bubbles:true}));};
    set(selects[2],'2004');return true;
  })()`);
  assert(changed,'GUVI controls missing');
  await wait(300);
  await evaluate(`(()=>{
    const card=[...document.querySelectorAll('.omni-range-card')].find(c=>c.textContent.includes('Thermosphere O/N2'));
    const select=card.querySelectorAll('select')[0];select.value='4';select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await wait(300);
  await evaluate(`(()=>{
    const card=[...document.querySelectorAll('.omni-range-card')].find(c=>c.textContent.includes('Thermosphere O/N2'));
    const select=card.querySelectorAll('select')[1];select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await wait(300);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Load O/N2')?.click()`);
  let state;
  for(let i=0;i<110;i++){
    state=await evaluate(`({measured:document.body.innerText.includes('32 valid orbit samples'),charts:document.querySelectorAll('canvas').length,errors:[...document.querySelectorAll('.banner-alert,.error-box')].map(e=>e.textContent)})`);
    if(state.measured||state.errors.length)break;
    await wait(1000);
  }
  console.log(JSON.stringify(state));
  assert(state.measured,'Real GUVI samples did not reach the page');
  assert(state.charts>0,'GUVI chart did not render');
  assert.deepEqual(errors,[]);
}finally{await send('Page.close');socket.close();}
