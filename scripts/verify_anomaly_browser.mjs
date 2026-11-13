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
 await send('Page.navigate',{url:'http://127.0.0.1:3000/anomaly-detection/'});
 let initial;
 for(let i=0;i<75;i++){
  initial=await evaluate(`({loading:document.body.innerText.includes('Loading TEC anomaly analytics'),charts:document.querySelectorAll('main canvas').length,error:[...document.querySelectorAll('.banner-alert')].map(e=>e.textContent)})`);
  if(initial && !initial.loading&&(initial.charts||initial.error.length))break;
  await wait(1000);
 }
 console.log('Initial',JSON.stringify(initial));assert.equal(initial.error.length,0);assert(initial.charts>0);
 for(const label of ['Storm Comparison','Diurnal Variation','Seasonal Variation','Solar Cycle','EIA Study','TEC Prediction','Ionospheric Scintillation']){
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)})?.click()`);
  await wait(1200);
  const state=await evaluate(`({charts:document.querySelectorAll('main canvas').length,error:[...document.querySelectorAll('.banner-alert')].map(e=>e.textContent),scintPlots:document.querySelectorAll('.scint-plot').length,fakeSvg:document.querySelectorAll('.scint-plot svg').length,missingMeasured:document.body.innerText.includes('measured observations are not connected'),text:document.querySelector('main')?.innerText.slice(-150)})`);
  console.log(label,JSON.stringify(state));
  assert.equal(state.error.length,0);
  if(['Diurnal Variation','Seasonal Variation','Solar Cycle'].includes(label))assert(state.charts>0,label+' chart missing');
  if(label==='Ionospheric Scintillation'){assert(state.missingMeasured);assert.equal(state.fakeSvg,0);}
 }
 await evaluate(`(()=>{
  const select=document.querySelector('select');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'karo');select.dispatchEvent(new Event('change',{bubbles:true}));
 })()`);
 await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Anomaly Detection')?.click()`);
 await wait(10000);
 const station=await evaluate(`({value:document.querySelector('select')?.value,loading:document.body.innerText.includes('Loading TEC anomaly analytics'),charts:document.querySelectorAll('main canvas').length,errors:[...document.querySelectorAll('.banner-alert')].map(e=>e.textContent)})`);
 console.log('Station filter',JSON.stringify(station));assert.equal(station.value,'karo');assert.equal(station.errors.length,0);assert(station.charts>0);
 assert.deepEqual(errors,[]);
}finally{await send('Page.close');socket.close();}
