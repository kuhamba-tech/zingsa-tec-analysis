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
  await send('Page.navigate',{url:'http://127.0.0.1:3000/time-series/'});
  await wait(12000);
  for (const [index,value] of [[1,'2019'],[0,'4'],[3,'2019'],[2,'6']]) {
    const changed=await evaluate(`(()=>{
      const card=[...document.querySelectorAll('.omni-range-card')].find(c=>c.textContent.includes('Space Segment - Geomagnetic'));
      const select=card?.querySelectorAll('select')[${index}];
      if(!select)return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(value)});
      select.dispatchEvent(new Event('change',{bubbles:true}));return true;
    })()`);
    assert(changed,'Source date control missing');
    await wait(250);
  }
  await evaluate(`Array.from(document.querySelectorAll('button.tab')).find(b=>b.textContent==='Source Comparison')?.click()`);
  await wait(300);
  const clicked=await evaluate(`(()=>{
    const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load all sources');
    if(!button||button.disabled)return false;button.click();return true;
  })()`);
  assert(clicked,'Load all sources unavailable');
  let state;
  for(let i=0;i<60;i++) {
    state=await evaluate(`(()=>{
      const panel=document.querySelector('section[aria-label="Selected-date heliospheric comparison"]');
      return {header:panel?.querySelector('strong')?.textContent,headings:[...panel?.querySelectorAll('h3')??[]].map(e=>e.textContent),charts:panel?.querySelectorAll('canvas').length??0,
      selected:panel?.textContent.includes('2019-04-01 to 2019-06-30 UTC'),missing:panel?.textContent.includes('No valid observations returned'),
      error:panel?.querySelector('[role="alert"]')?.textContent??null};
    })()`);
    if(state.charts===4||state.error)break;
    await wait(1000);
  }
  console.log(JSON.stringify(state));
  assert(state.selected,'Chart dates differ from selected source dates');
  assert.equal(state.headings.length,5,'All five driver panels must be present');
  assert.equal(state.charts,4,'Four historical graphs must render; GOES X-ray coverage is unavailable for this interval');
  assert.equal(state.missing,true);
  assert.deepEqual(errors,[]);
} finally {await send('Page.close');socket.close();}
