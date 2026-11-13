// Read-only browser regression for startup history and App Router navigation.
import assert from "node:assert/strict";
const target = await fetch("http://127.0.0.1:9223/json/new?about:blank", {method:"PUT"}).then(r=>r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.addEventListener("open",resolve,{once:true});ws.addEventListener("error",reject,{once:true});});
let sequence=0;const pending=new Map(),errors=[];
ws.addEventListener("message",({data})=>{
  const message=JSON.parse(data);
  if(message.method==="Runtime.consoleAPICalled"&&message.params.type==="error")errors.push(message.params.args.map(a=>a.value??a.description??"").join(" "));
  if(message.method==="Runtime.exceptionThrown")errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);
  const request=pending.get(message.id);if(request){pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(message.error):request.resolve(message.result);}
});
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(new Error(method+" timed out")),25000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result?.value;}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(expression){for(let i=0;i<80;i++){if(await evaluate(expression))return;await sleep(500);}throw new Error("Not ready: "+expression);}
try{
  await send("Runtime.enable");await send("Page.enable");
  await send("Page.navigate",{url:"http://127.0.0.1:3000/gic-monitor/?_chunk=router-check&station=DEMA#observations"});
  await until("window.history.state?.__NA===true && !!document.querySelector('main')");
  await until("!new URL(location.href).searchParams.has('_chunk')");
  const startup=await evaluate("({initialized:history.state?.__NA===true,tree:!!history.state?.__PRIVATE_NEXTJS_INTERNALS_TREE,station:new URL(location.href).searchParams.get('station'),hash:location.hash})");
  assert.deepEqual(startup,{initialized:true,tree:true,station:"DEMA",hash:"#observations"});
  console.log("PASS: recovery parameter cleanup preserves initialized history, query and hash");
  for(const route of ["/processing","/reports","/gic-monitor"]){
    const lookup=`Array.from(document.querySelectorAll('a')).find(a=>new URL(a.href,location.origin).pathname.replace(/\\/$/,'')===${JSON.stringify(route)})`;
    await until(`!!(${lookup})`);await evaluate(`(${lookup}).click()`);
    await until(`location.pathname.replace(/\\/$/,'')===${JSON.stringify(route)} && history.state?.__NA===true`);
    console.log("PASS: client navigation "+route);
  }
  await sleep(1500);
  const routerErrors=errors.filter(error=>/Router action dispatched before initialization|E668|script tag while rendering|Hydration failed/.test(error));
  assert.deepEqual(routerErrors,[]);
  console.log("PASS: no router initialization, script-rendering or hydration errors");
}finally{await send("Page.close").catch(()=>{});ws.close();}
