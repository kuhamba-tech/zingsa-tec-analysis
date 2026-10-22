"use client";

import {useEffect,useRef,useState} from "react";
import LineChart from "@/components/charts/LineChart";
import {getTecClimatology} from "@/lib/api";
import type {ResearchRow,TecClimatology} from "@/lib/tecClimatology";
import {ZIMBABWE_POLYGON} from "@/lib/zimbabweBoundary";
import {downloadGraph} from "./GraphExports";
import ResearchExtras from "./ResearchExtras";
import styles from "./page.module.css";

const colors:Record<string,string>={northern:"#38bdf8",central:"#4ade80",southern:"#fb923c"};
const tabs=["Diurnal Variation","Latitudinal & Regional Variation","Annual Variation","Seasonal Variation"];
function save(text:string,name:string,type:string){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function csv(rows:Record<string,unknown>[],name:string){if(!rows.length)return;const keys=Object.keys(rows[0]);const cell=(v:unknown)=>`"${String(Array.isArray(v)?v.join(";"):v??"").replaceAll('"','""')}"`;save([keys.map(cell).join(","),...rows.map(r=>keys.map(k=>cell(r[k])).join(","))].join("\r\n"),name,"text/csv;charset=utf-8");}

function Plot({title,rows,periods,data,boxes=false,heat=false}:{title:string;rows:ResearchRow[];periods:string[];data:TecClimatology;boxes?:boolean;heat?:boolean}){
 const svg=useRef<SVGSVGElement>(null);
 const host=useRef<HTMLElement>(null);
 const groups=[...new Set(rows.map(r=>r.region))];
 const heatRows=[...new Set(periods.map(p=>p.slice(0,-3)))];
 const dataset=groups.flatMap(region=>["mean","median"].map(stat=>({label:`${region} ${stat}`,color:colors[region]??"#c084fc",dashed:stat==="median",spanGaps:false,data:periods.map(p=>{const row=rows.find(r=>r.period===p&&r.region===region);return row?(stat==="mean"?row.mean:row.median):null;})})));
 const max=Math.max(1,...rows.map(r=>r.maximum??r.mean)),min=Math.min(0,...rows.map(r=>r.minimum??r.mean));
 const y=(v:number)=>260-(v-min)/(max-min)*200;
 const summary=`${data.start} to ${data.end} · ${data.timezone} · ${data.resolution_minutes}-minute bins · ${[...new Set(rows.flatMap(r=>r.station_ids))].length} stations · ${rows.reduce((n,r)=>n+r.observations,0)} observations`;
 const exportSvg=()=>{const section=host.current;if(section)downloadGraph(section,summary);};
 const exportPng=()=>{const section=host.current;if(section)downloadGraph(section,summary,true);};
 return <section ref={host} className="card" style={{marginTop:16}}><h2>{title}</h2><p>{summary}</p>
 <p>TECU · Completeness: {rows.length?`${Math.min(...rows.map(r=>r.completeness_pct)).toFixed(1)}–${Math.max(...rows.map(r=>r.completeness_pct)).toFixed(1)}%`:"0%"} of selected station/time bins. Blank periods have no measurements.</p>
 {!rows.length?<p role="status">No measured observations in this range.</p>:<>
 {!boxes&&!heat&&<LineChart labels={periods} datasets={dataset} yLabel="VTEC (TECU)" height={300}/>}
 {(boxes||heat)&&<svg ref={svg} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 350" role="img" aria-label={title} style={{width:"100%",display:boxes||heat?"block":"none"}}>
 <rect width="800" height="350" fill="#0b1220"/><text x="25" y="22" fill="white" fontSize="15">{title} · TECU</text><text x="25" y="42" fill="white" fontSize="9">{summary}</text>
 {heat?rows.map((r,i)=><g key={i}><rect x={60+Number(r.period.slice(-2))*28} y={60+heatRows.indexOf(r.period.slice(0,-3))*Math.min(12,220/Math.max(1,periods.length/24))} width="26" height={Math.min(12,220/Math.max(1,periods.length/24))} fill={`hsl(${240-240*(r.mean-min)/(max-min)} 85% 55%)`}><title>{r.period}: {r.mean.toFixed(2)} TECU; {r.completeness_pct}%</title></rect></g>):groups.map(region=><g key={region}>{periods.map((p,i)=>{const r=rows.find(x=>x.period===p&&x.region===region);if(!r)return null;const x=60+i*680/Math.max(1,periods.length-1);return boxes?<g key={p} stroke={colors[region]??"#c084fc"}><line x1={x} x2={x} y1={y(r.minimum)} y2={y(r.maximum)}/><rect x={x-4} y={y(r.q3)} width="8" height={Math.max(1,y(r.q1)-y(r.q3))} fill="none"/><line x1={x-5} x2={x+5} y1={y(r.median)} y2={y(r.median)}/></g>:<g key={p}><circle cx={x} cy={y(r.mean)} r="3" fill={colors[region]??"#c084fc"}/>{i>0&&(()=>{const prev=rows.find(z=>z.period===periods[i-1]&&z.region===region);return prev?<line x1={60+(i-1)*680/Math.max(1,periods.length-1)} y1={y(prev.mean)} x2={x} y2={y(r.mean)} stroke={colors[region]??"#c084fc"}/>:null;})()}</g>;})}</g>)}
 <text x="5" y="65" fill="white" fontSize="9">{max.toFixed(1)}</text><text x="5" y="260" fill="white" fontSize="9">{min.toFixed(1)}</text><text x="25" y="285" fill="white" fontSize="10">{heat?"Hour 00 → 23; rows follow exported periods. Colour: blue (low) → red (high).":`${periods[0]??""} → ${periods.at(-1)??""} · ${groups.join(" / ")}`}</text>
 <text x="25" y="305" fill="white" fontSize="9">{data.source.slice(0,145)}</text><text x="25" y="325" fill="white" fontSize="9">Missing periods remain blank. Completeness and station contributions are in the CSV.</text>
 </svg>}
 <button className="btn" onClick={()=>csv(rows.map(r=>({...r,start:data.start,end:data.end,timezone:data.timezone,source:data.source})),`${title}.csv`)}>CSV</button>{" "}<button className="btn" onClick={exportPng}>PNG (2400 px)</button>{" "}<button className="btn" onClick={exportSvg}>SVG</button>
 </>}
 </section>;
}

export default function TecClimatologyPage(){
 const today=new Date().toISOString().slice(0,10);
 const [start,setStart]=useState(today.slice(0,7)+"-01"),[end,setEnd]=useState(today),[tz,setTz]=useState("CAT"),[minutes,setMinutes]=useState("60"),[regions,setRegions]=useState<string[]>([]),[stations,setStations]=useState<string[]>([]),[tab,setTab]=useState(0),[data,setData]=useState<TecClimatology|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false),[seasons,setSeasons]=useState('{"March equinox":[2,3,4],"June solstice":[5,6,7],"September equinox":[8,9,10],"December solstice":[11,12,1]}');
 const generation=useRef(0);
 const load=async()=>{const id=++generation.current;setLoading(true);setError("");try{const result=await getTecClimatology({start,end,tz,minutes:Number(minutes),regions:regions.join(","),stations:stations.join(","),seasons});if(id===generation.current)setData(result);}catch(e){if(id===generation.current)setError(e instanceof Error?e.message:"Research data unavailable");}finally{if(id===generation.current)setLoading(false);}};
 useEffect(()=>{void load();return()=>{generation.current++;};},[]); // Explicit Apply prevents large queries on every control change.
 const plot=(key:string,title:string,boxes=false,heat=false,region?:string)=>data?<Plot key={`${key}-${region}-${boxes}`} title={title} rows={(data.tables[key]??[]).filter(r=>!region||r.region===region)} periods={data.expected_periods[key]??[]} data={data} boxes={boxes} heat={heat}/>:null;
 return <div className={styles.page}><h1>TEC Climatology &amp; Regional Analysis</h1><p>Historical measured Zimbabwe CORS TEC · fixed North / Central / South regions</p>
 <section className="card" style={{display:"flex",gap:12,flexWrap:"wrap"}}>
 <label>From <input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Through <input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>
 <label>Year <input type="number" min="1900" max="2100" value={start.slice(0,4)} onChange={e=>{setStart(`${e.target.value}-01-01`);setEnd(`${e.target.value}-12-31`);}}/></label>
 <label>Time <select value={tz} onChange={e=>setTz(e.target.value)}><option>CAT</option><option>UTC</option></select></label>
 <label>Resolution <select value={minutes} onChange={e=>setMinutes(e.target.value)}>{[15,30,60].map(m=><option key={m} value={m}>{m} minutes</option>)}</select></label>
 <fieldset><legend>Regions (none selected = All Zimbabwe)</legend>{Object.keys(colors).map(r=><label key={r} style={{marginRight:12}}><input type="checkbox" checked={regions.includes(r)} onChange={e=>setRegions(e.target.checked?[...regions,r]:regions.filter(x=>x!==r))}/>{r}</label>)}</fieldset>
 <label>Stations (multiple; none = all)<select multiple value={stations} onChange={e=>setStations([...e.target.selectedOptions].map(o=>o.value))}>{data?.catalog.filter(s=>!regions.length||regions.includes(s.region)).map(s=><option key={s.code} value={s.code}>{s.code.toUpperCase()} · {s.region}</option>)}</select></label>
 <label>Geomagnetic filter <select disabled><option>All observations — verified historical indices not yet linked</option></select></label>
 <button className="btn" disabled={loading} onClick={()=>void load()}>{loading?"Calculating…":"Apply / Refresh"}</button>
 </section>
 <details className="card"><summary>Season configuration</summary><p>Four named groups; each month must appear once. Wrapping seasons use their ending year.</p><textarea aria-label="Season groups JSON" value={seasons} onChange={e=>setSeasons(e.target.value)} rows={4} style={{width:"100%"}}/></details>
 {error&&<p role="alert">{error}</p>}
 {data&&<><section className="card"><h2>Historical capture</h2><p>Capture: {data.capture.state} · {data.capture.active_stations_15min} active stations in 15 minutes · Latest batch storage delay: {data.capture.latest_batch_delay_s??"Unavailable"} seconds</p><p>Earliest retained: {data.capture.earliest??"Unavailable"} · Last observation: {data.capture.latest??"Unavailable"} · Last stored: {data.capture.last_stored??"Unknown for pre-migration data"} (UTC)</p><p>{data.contributing_stations} contributing stations · {data.observations.toLocaleString()} measured observations in {data.start}–{data.end}, {data.timezone}. Browser-independent collector; refresh updates the analysis.</p><p>Missing dates and incomplete seasons are included in completeness denominators. No measurements are fabricated.</p></section>
 <div role="tablist" aria-label="TEC analyses" style={{display:"flex",gap:8,flexWrap:"wrap"}}>{tabs.map((t,i)=><button className="btn" role="tab" aria-selected={tab===i} key={t} onClick={()=>setTab(i)}>{t}</button>)}</div>
 {tab===0&&<>{plot("hour","Regional 24-hour mean and median")}{plot("daynight","Daytime and nighttime TEC")}{Object.keys(colors).map(r=>plot("day_hour",`${r}: date versus hour`,false,true,r))}<section className="card"><h2>Station hourly profiles and peak time</h2>{data.stations.filter(s=>s.hourly.length).map(s=><details key={s.code}><summary>{s.code.toUpperCase()} · {s.region} · peak {s.hourly.reduce((a,b)=>a.mean>b.mean?a:b).hour}:00 {data.timezone}</summary><LineChart labels={Array.from({length:24},(_,h)=>String(h))} datasets={[{label:s.code,data:Array.from({length:24},(_,h)=>s.hourly.find(x=>x.hour===h)?.mean??null),spanGaps:false},{label:`${s.region} regional mean`,data:Array.from({length:24},(_,h)=>data.tables.hour.find(r=>r.region===s.region&&Number(r.period)===h)?.mean??null),spanGaps:false}]} yLabel="VTEC (TECU)"/><button className="btn" onClick={()=>csv(s.hourly.map(h=>({...h,station:s.code,timezone:data.timezone})),`${s.code}-hourly.csv`)}>Station CSV</button></details>)}</section></>}
 {tab===2&&<>{plot("day","Daily regional TEC")}{plot("month","Monthly regional mean and median")}{plot("month","Monthly station-summary box plots",true)}{Object.keys(colors).map(r=>plot("month_hour",`${r}: month versus hour`,false,true,r))}</>}
 {tab===3&&<>{plot("season","Seasonal regional mean and median")}{plot("season","Seasonal station-summary box plots",true)}{plot("season_hour","Seasonal diurnal profiles")}{plot("season_daynight","Seasonal daytime and nighttime")}</>}
 {tab===1&&<><section className="card"><h2>Station positions and regional membership</h2><p>Station coordinate plot, longitude × latitude; no spatial interpolation. Coloured stations have observations in the selected range.</p><svg viewBox="0 0 800 400" style={{width:"100%"}} role="img" aria-label="Zimbabwe CORS station coordinates"><polygon points={ZIMBABWE_POLYGON.map(([lon,lat])=>`${(lon-25)*90},${(-15-lat)*48}`).join(" ")} fill="#0b2030" stroke="#94a3b8"/>{[-18.2,-20.2].map(lat=><line key={lat} x1="0" x2="750" y1={(-15-lat)*48} y2={(-15-lat)*48} stroke="#94a3b8" strokeDasharray="5 5"/>)}{data.catalog.map(s=><g key={s.code}><circle cx={(s.longitude-25)*90} cy={(-15-s.latitude)*48} r="5" fill={data.stations.find(x=>x.code===s.code)?.observations?colors[s.region]:"#64748b"}/><text x={(s.longitude-25)*90+7} y={(-15-s.latitude)*48} fontSize="11" fill="white">{s.code.toUpperCase()}</text></g>)}</svg><p>{data.geomagnetic_model}</p></section>{plot("hour","Regional latitude bands by hour")}<section className="card"><h2>Matched regional differences (TECU)</h2><p>Same time bins only; these are broad regional differences, not exact local gradients.</p><button className="btn" onClick={()=>csv(data.differences,"matched-regional-differences.csv")}>Download matched differences</button>{[...new Set(data.differences.map(x=>x.pair))].map(pair=>{const rows=data.differences.filter(x=>x.pair===pair);return <LineChart key={pair} labels={rows.map(r=>r.time)} datasets={[{label:pair,data:rows.map(r=>r.delta_tecu),spanGaps:false}]} yLabel="Difference (TECU)"/>;})}</section></>}
 <ResearchExtras data={data} tab={tab}/>
 <section className="card"><h2>Station and region statistics</h2><button className="btn" onClick={()=>csv(data.stations.map(({hourly,...s})=>({...s,start:data.start,end:data.end,timezone:data.timezone})),"station-statistics.csv")}>Export statistics</button><div style={{overflowX:"auto"}}><table><thead><tr>{["Station","Region","Latitude","Geomagnetic latitude","Mean TECU","Observations","Completeness"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{data.stations.map(s=><tr key={s.code}><td>{s.code.toUpperCase()}</td><td>{s.region}</td><td>{s.latitude.toFixed(3)}</td><td>{s.magnetic_latitude?.toFixed(3)??"Unavailable"}</td><td>{s.mean?.toFixed(2)??"No data"}</td><td>{s.observations}</td><td>{s.completeness_pct}%</td></tr>)}</tbody></table></div></section>
 <details className="card"><summary>Methods, coverage and limitations</summary>{data.methods.map(m=><p key={m}>{m}</p>)}<p>{data.source}</p><a href="https://www.ngdc.noaa.gov/IAGA/vmod/coeffs/igrf14coeffs.txt">IGRF-14 coefficient source</a></details></>}
 </div>;
}
