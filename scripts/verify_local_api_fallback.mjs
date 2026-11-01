// Exercises the real API client with controlled transport failures; sends no data.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "../frontend/node_modules/typescript/lib/typescript.js";

const browser={location:{hostname:"127.0.0.1",origin:"http://127.0.0.1:3000",port:"3000",protocol:"http:"}};
const processStub={env:{NODE_ENV:"development",NEXT_PUBLIC_API_KEY:"test-only"}};
function compile(source){return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;}
const urls={exports:{}};
new Function("exports","module","window","process",compile(await readFile(new URL("../frontend/lib/clientApiBase.ts",import.meta.url),"utf8")))(urls.exports,urls,browser,processStub);
const api={exports:{}};let requests=[];let mode="network";
async function fetchStub(url,init){
 requests.push({url,headers:init.headers});
 if(mode==="network" && requests.length===1)throw new TypeError("Failed to fetch");
 if(mode==="denied")return {ok:false,status:401};
 return {ok:true,status:200,json:async()=>({available:true,stations:[]})};
}
new Function("require","exports","module","process","fetch",compile(await readFile(new URL("../frontend/lib/api.ts",import.meta.url),"utf8")))(name=>name==="./clientApiBase"?urls.exports:{},api.exports,api,processStub,fetchStub);

await api.exports.getTecMethodComparison(2,undefined,300);
assert.equal(requests.length,2);
const fallback=new URL(requests[1].url);
assert.equal(fallback.origin,"http://127.0.0.1:3000");
assert.equal(fallback.pathname,"/api/zgiis/live/tec-method-comparison");
assert.equal(fallback.searchParams.get("hours"),"2");
assert.equal(fallback.searchParams.get("limit"),"300");
assert.equal(requests[1].headers["X-API-Key"],"test-only");
requests=[];mode="denied";
await assert.rejects(api.exports.getTecMethodComparison(2,undefined,301));
assert.equal(requests.length,1,"HTTP authorization failures must not use another route");
browser.location={hostname:"zingsa-gnss-tec.vercel.app",origin:"https://zingsa-gnss-tec.vercel.app",port:"",protocol:"https:"};
requests=[];mode="network";
await assert.rejects(api.exports.getTecMethodComparison(2,undefined,302));
assert.equal(requests.length,1,"Production must not fall back to a local proxy");
assert.equal(urls.exports.localApiFallbackUrl("https://example.com/live/vtec"),null);
console.log("PASS: local network recovery, preserved request parameters/auth headers, no HTTP-auth or production fallback");
