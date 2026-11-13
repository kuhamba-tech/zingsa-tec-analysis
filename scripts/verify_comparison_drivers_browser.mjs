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
  await wait(3000);
  let ready=false;
  for(let i=0;i<90;i++) {
    ready=await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load all sources');return !!b&&!b.disabled})()`);
    if(ready)break;
    await wait(1000);
  }
  assert(ready,'Initial archive load did not finish');
  for (const [label, target, day] of [["Source start date", "April 2019", "2019-04-01"], ["Source end date", "June 2019", "2019-06-30"]]) {
    await evaluate(`document.querySelector('button[aria-label="${label}"]').click()`);
    await wait(100);
    let reached=false;
    for(let i=0;i<180;i++) {
      const month=await evaluate(`document.querySelector('[role="dialog"] strong')?.textContent`);
      if(month===target){reached=true;break;}
      await evaluate(`document.querySelector('[role="dialog"] button[aria-label="Previous month"]').click()`);
      await wait(60);
    }
    assert(reached, 'Calendar could not reach '+target);
    await evaluate(`document.querySelector('[role="dialog"] button[aria-label="${day}"]').click()`);
    await wait(100);
    await evaluate(`[...document.querySelector('[role="dialog"]').querySelectorAll('button')].find(b=>b.textContent==='Set Date').click()`);
    await wait(100);
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
  assert.deepEqual(state.headings, ['GOES X-ray flux','Energetic proton flux','Solar wind','Interplanetary magnetic field','Dst \u2014 ring current']);
  for(let i=0;i<90;i++) {
    if(await evaluate(`!document.body.innerText.includes('Still checking the remaining sources') && ![...document.querySelectorAll('button')].some(b=>b.textContent.includes('Loading all sources'))`))break;
    await wait(1000);
  }
  const flow = await evaluate(`(()=>{
    const text=[...document.querySelectorAll('.card')].map(c=>c.innerText).join('\\n');
    const markers=['F10.7 solar flux','GOES X-ray flux','Solar wind','Interplanetary magnetic field','Kp index','VTEC with multi-source storm days'];
    return {positions:markers.map(m=>text.indexOf(m)), tabs:[...document.querySelectorAll('button.tab')].map(b=>b.textContent),
      charts:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height})),
      shaded: document.body.innerText.includes('Red shading marks the same UTC days')};
  })()`);
  console.log('Flow',JSON.stringify(flow));
  assert(flow.positions.slice(1,5).every(p=>p>=0),'Missing solar, driver or geomagnetic stage');
  assert(flow.positions.filter(p=>p>=0).every((p,i,arr)=>i===0||p>arr[i-1]),'Sun-to-Earth stages are out of order');
  assert(!flow.tabs.includes('Daily Variation')&&!flow.tabs.includes('COSMIC-2'),'Removed tabs reappeared');
  assert(flow.shaded,'Shared storm-day explanation missing');
  assert(flow.charts.every(c=>c.width>0&&c.height>0),'Chart has zero dimensions');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await wait(1000);
  const mobile=await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth, charts:[...document.querySelectorAll('canvas')].filter(c=>c.getBoundingClientRect().width>0).length})`);
  assert(mobile.scroll<=mobile.width+2,'Page overflows the mobile viewport');
  assert(mobile.charts>0,'No mobile charts visible');
  console.log('PASS graph order, removed tabs, nonzero charts, shared shading text and mobile viewport',JSON.stringify(mobile));
  assert.deepEqual(errors,[]);
} finally {await send('Page.close');socket.close();}
