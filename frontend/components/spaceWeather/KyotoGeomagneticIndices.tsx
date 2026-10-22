"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import LineChart from "@/components/charts/LineChart";
import {getKyotoIndices,getKyotoVtecComparison} from "@/lib/api";
import {KYOTO_KEYS,minuteGrid,csvDownload,type KyotoKey,type KyotoResponse} from "@/lib/kyotoIndices";
import {utcTimeAxisProps} from "@/lib/chartTimeAxis";
import {downloadGraph} from "@/app/tec-climatology/GraphExports";

const COLORS=["#38bdf8","#fbbf24","#c084fc","#4ade80"];
type Comparison=Awaited<ReturnType<typeof getKyotoVtecComparison>>;

export default function KyotoGeomagneticIndices({comparison=false}:{comparison?:boolean}){
 const [mode,setMode]=useState("live"),[hours,setHours]=useState(24);
 const [start,setStart]=useState(""),[end,setEnd]=useState("");
 const [historical,setHistorical]=useState<{start:string;end:string}|null>(null);
 const [data,setData]=useState<KyotoResponse|null>(null),[error,setError]=useState("");
 const [loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0);
 const [now,setNow]=useState(Date.now()),[hover,setHover]=useState<number|null>(null);
 const [domain,setDomain]=useState<{min:number;max:number}|null>(null);
 const [region,setRegion]=useState("all"),[station,setStation]=useState(""),[index,setIndex]=useState<KyotoKey>("SYM-H");
 const [vtec,setVtec]=useState<Comparison|null>(null),[vtecError,setVtecError]=useState("");
 const sequence=useRef(0);

 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30_000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{
  if(mode!=="live")return;
  const timer=setInterval(()=>{if(document.visibilityState==="visible")setRefresh(n=>n+1);},900_000);
  return()=>clearInterval(timer);
 },[mode]);
 useEffect(()=>{
  if(mode==="historical"&&!historical)return;
  const id=++sequence.current;setLoading(true);setError("");
  const params=mode==="historical"?{hours,...historical!}:{hours};
  // Different modes/ranges never borrow each other's cached observations.
  setData(null);setVtec(null);
  getKyotoIndices(params).then(result=>{if(sequence.current===id){setData(result);setDomain({min:Date.parse(result.start),max:Date.parse(result.end)});}})
   .catch(e=>{if(sequence.current===id)setError(e instanceof Error?e.message:"Kyoto unavailable");})
   .finally(()=>{if(sequence.current===id)setLoading(false);});
  return()=>{sequence.current++;};
 },[mode,hours,historical,refresh]);
 useEffect(()=>{
  if(!comparison||!data)return;
  let active=true;setVtec(null);setVtecError("");
  getKyotoVtecComparison({start:data.start,end:data.end,region,station}).then(result=>{if(active)setVtec(result);}).catch(e=>{if(active)setVtecError(e instanceof Error?e.message:"CORS archive unavailable");});
  return()=>{active=false;};
 },[comparison,data,region,station]);

 const grid=useMemo(()=>data?minuteGrid(data.start,data.end):[],[data]);
 const byTime=useMemo(()=>new Map(data?.rows.map(r=>[Date.parse(r.time),r])??[]),[data]);
 const vtecByTime=useMemo(()=>new Map(vtec?.points.map(r=>[Date.parse(r.time),r])??[]),[vtec]);
 const age=data?.latest_observation?Math.max(0,(now-Date.parse(data.latest_observation))/1000):null;
 const status=error||data?.fetch_error?"unavailable":age===null?"unavailable":age>600?"delayed":"connected";
 const ageText=age===null?"Unavailable":`${Math.floor(age/86400)}d ${Math.floor(age%86400/3600)}h ${Math.floor(age%3600/60)}m`;
 const caption=data?`${data.source} | ${data.dataset} | ${data.product_status} | ${data.start} to ${data.end} | UTC | nT | ${data.rows.length} source rows`:"";
 function move(factor:number,pan=0){if(!data||!domain)return;const fullMin=Date.parse(data.start),fullMax=Date.parse(data.end);const width=Math.min(fullMax-fullMin,Math.max(300_000,(domain.max-domain.min)*factor));const mid=(domain.min+domain.max)/2+pan*(domain.max-domain.min);const min=Math.max(fullMin,Math.min(fullMax-width,mid-width/2));setDomain({min,max:min+width});}
 function applyHistory(){if(!start||!end){setError("Select both UTC dates.");return;}const a=Date.parse(start+'Z'),b=Date.parse(end+'Z');if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||b-a>7*86400000){setError("Select an ordered UTC range of up to seven days.");return;}setHistorical({start:new Date(a).toISOString(),end:new Date(b).toISOString()});setMode("historical");}
 function exportComparison(){if(!data||!vtec)return;const rows=vtec.points.flatMap(p=>{const geo=byTime.get(Date.parse(p.time));if(!geo||geo[index]===null)return[];return[{time_utc:p.time,vtec_tecu:p.vtec,stations:p.stations,cors_observations:p.observations,index,index_nt:geo[index],index_source:data.source,index_status:geo.product_status,version_code:geo.version_code,vtec_source:"CORS code_live; equal-station minute-bin means",matching:"same UTC minute bin; no interpolation",region,station:station||"all",quality:geo.quality}];});csvDownload(rows,"zimbabwe-vtec-kyoto-matched.csv");}

 return <section className="card" style={{marginTop:20,padding:"1.2rem"}} aria-label={comparison?"Zimbabwe VTEC geomagnetic comparison":"Geomagnetic indices"}>
 <h2 style={{fontWeight:750,fontSize:"1.15rem",marginBottom:12}}>{comparison?"ZIMBABWE VTEC ↔ SYM-H / ASY-H":"GEOMAGNETIC INDICES — LATEST AVAILABLE OBSERVATIONS"}</h2>
 <p>World Data Center for Geomagnetism, Kyoto</p>
 <div style={{display:"flex",gap:8,flexWrap:"wrap",margin:"12px 0"}}>
 <label>Mode <select value={mode} onChange={e=>{setMode(e.target.value);setData(null);setError("");}}><option value="live">Live (latest available)</option><option value="historical">Historical</option></select></label>
 {[6,24,168].map(h=><button className="btn" aria-pressed={hours===h&&mode==="live"} key={h} onClick={()=>{setMode("live");setHours(h);}}>{h===168?"7D":`${h}H`}</button>)}
 <button className="btn" onClick={()=>setRefresh(n=>n+1)} disabled={loading}>Refresh</button>
 <button className="btn" onClick={()=>{setStart("2024-05-10T00:00");setEnd("2024-05-14T00:00");setHistorical({start:"2024-05-10T00:00:00Z",end:"2024-05-14T00:00:00Z"});setMode("historical");}}>10–13 May 2024 (historical)</button>
 </div>
 {mode==="historical"&&<div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}><label>Start UTC <input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label><label>End UTC (exclusive) <input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label><button className="btn" onClick={applyHistory}>Apply historical range</button><p>Up to seven days per request; use consecutive windows for longer studies.</p></div>}
 {loading&&<p role="status">Retrieving verified Kyoto observations…</p>}{error&&<p role="alert" className="banner banner-info">{error}</p>}
 {data&&<>
 <div className="banner banner-info" role="status"><strong>SOURCE:</strong> WDC Kyoto · <strong>LATEST OBSERVATION{mode==="historical"?" IN RANGE":""}:</strong> {data.latest_observation??"Unavailable"} · <strong>DATA AGE:</strong> {ageText}<br/><strong>PRODUCT STATUS:</strong> {data.product_status} · <strong>LAST SUCCESSFUL FETCH:</strong> {data.last_successful_fetch} · <strong>CONNECTION STATUS:</strong> {status}</div>
 {(status!=="connected"||data.publication_warning)&&<p role="status" style={{color:"#fbbf24",margin:"12px 0"}}>{data.publication_warning??(mode==="historical"?"Historical observations: data age is not a live-feed indicator.":"Observations are delayed or unavailable. Request success does not indicate current measurements.")}</p>}
 <p>Displayed UTC window: {data.start} — {data.end}. Source cadence: 1 minute. Live refresh: 15 minutes. No smoothing, interpolation or extrapolation.</p>
 <div style={{display:"flex",gap:8,flexWrap:"wrap",margin:"12px 0"}}><button className="btn" onClick={()=>move(.5)}>Zoom in — all panels</button><button className="btn" onClick={()=>move(2)}>Zoom out</button><button className="btn" onClick={()=>move(1,-.25)}>Pan earlier</button><button className="btn" onClick={()=>move(1,.25)}>Pan later</button><button className="btn" onClick={()=>setDomain({min:Date.parse(data.start),max:Date.parse(data.end)})}>Reset view</button><button className="btn" onClick={()=>csvDownload(data.rows.map(r=>({...r,units:"nT",source:data.source,dataset:data.dataset,window_start:data.start,window_end:data.end})),"kyoto-asysym.csv")}>Indices CSV</button></div>
 {comparison&&<><div style={{display:"flex",gap:10,flexWrap:"wrap"}}><label>Region <select value={region} onChange={e=>{setRegion(e.target.value);setStation("");}}><option value="all">All Zimbabwe</option><option value="northern">North Zimbabwe</option><option value="central">Central Zimbabwe</option><option value="southern">South Zimbabwe</option></select></label><label>Station <select value={station} onChange={e=>setStation(e.target.value)}><option value="">All selected region stations</option>{vtec?.catalog.filter(s=>region==="all"||s.region===region).map(s=><option key={s.code}>{s.code}</option>)}</select></label><label>Index <select value={index} onChange={e=>setIndex(e.target.value as KyotoKey)}><option>SYM-H</option><option>ASY-H</option></select></label><button className="btn" onClick={exportComparison} disabled={!vtec?.points.some(p=>byTime.get(Date.parse(p.time))?.[index]!=null)}>Time-matched CSV</button></div>
 <p>Regional assignments reuse the fixed map boundaries. Kyoto indices describe global geomagnetic disturbances; correlation with Zimbabwe TEC does not establish causation. Comparison uses matching UTC minute bins and equal station weights.</p>{vtecError&&<p role="alert">{vtecError}</p>}
 <section className="card" style={{marginTop:16}}><h3>Zimbabwe VTEC (TECU)</h3><p>CORS code_live · {vtec?.points.length??0} occupied minute bins · {vtec?.points.reduce((n,p)=>n+p.observations,0)??0} satellite observations</p>{!vtec?.points.length?<p>No measured CORS TEC overlaps this UTC window.</p>:<LineChart preserveSamples labels={grid.map(t=>new Date(t).toISOString())} xValues={grid} epochMs={grid} syncHoverMs={hover} onSyncHoverMs={setHover} datasets={[{label:"Measured VTEC",data:grid.map(t=>vtecByTime.get(t)?.vtec??null),color:"#22d3ee",spanGaps:false}]} yLabel="VTEC (TECU)" {...utcTimeAxisProps(domain)}/>}</section></>}
 {(comparison?[index]:[...KYOTO_KEYS]).map(key=><section className="card" key={key} style={{marginTop:16}}><h2 style={{fontWeight:700}}>{key} (nT)</h2><p>{data.rows.filter(r=>r[key]!==null).length} genuine samples · {data.product_status} · UTC</p>{!data.rows.some(r=>r[key]!==null)?<p>No {key} observations in this range.</p>:<LineChart preserveSamples labels={grid.map(t=>new Date(t).toISOString())} xValues={grid} epochMs={grid} syncHoverMs={hover} onSyncHoverMs={setHover} datasets={[{label:key,data:grid.map(t=>byTime.get(t)?.[key]??null),color:COLORS[KYOTO_KEYS.indexOf(key)],spanGaps:false}]} yLabel={`${key} (nT)`} height={240} {...utcTimeAxisProps(domain)}/>}<button className="btn" onClick={e=>downloadGraph(e.currentTarget.closest("section")!,caption)}>Graph SVG</button>{" "}<button className="btn" onClick={e=>downloadGraph(e.currentTarget.closest("section")!,caption,true)}>Graph PNG</button></section>)}
 <p><a href={data.source_url}>Official Kyoto HAPI source</a> · {data.dataset} · {data.persistence}. This archive updates on backend requests; it is not a continuously running ingestion worker.</p>
 </>}
 </section>;
}

export function KyotoComparison(){const [open,setOpen]=useState(false);return <section className="card" style={{marginTop:16}}><button className="btn" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>Optional research comparison: Zimbabwe VTEC ↔ SYM-H / ASY-H</button>{open&&<KyotoGeomagneticIndices comparison/>}</section>;}
