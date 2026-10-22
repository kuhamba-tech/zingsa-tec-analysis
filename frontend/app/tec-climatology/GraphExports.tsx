"use client";
import {useRef} from "react";
import {Chart} from "chart.js";
import type {TecClimatology} from "@/lib/tecClimatology";

const ns="http://www.w3.org/2000/svg";
function element(tag:string,attrs:Record<string,string|number>,text?:string){const node=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));if(text!==undefined)node.textContent=text;return node;}
export function sectionSvg(section:HTMLElement,caption:string):string{
 const canvas=section.querySelector("canvas");
 const chart=canvas?Chart.getChart(canvas):null;
 if(!chart){const original=section.querySelector("svg");if(!original)return "";const clone=original.cloneNode(true) as SVGSVGElement;clone.removeAttribute("style");clone.setAttribute("width","1600");clone.setAttribute("height","700");return new XMLSerializer().serializeToString(clone);}
 const width=chart.width,height=chart.height+90;
 const svg=element("svg",{xmlns:ns,viewBox:`0 0 ${width} ${height}`,width,height});
 svg.append(element("rect",{width,height,fill:"#0b1220"}));
 for(const scale of Object.values(chart.scales)){
  scale.ticks.forEach((tick,i)=>{
   const p=scale.getPixelForTick(i);
   const label=Array.isArray(tick.label)?tick.label.join(" "):String(tick.label??tick.value);
   if(scale.axis==="x")svg.append(element("text",{x:p,y:chart.chartArea.bottom+16,fill:"white","font-size":10,"text-anchor":"middle"},label));
   else svg.append(element("text",{x:chart.chartArea.left-5,y:p+3,fill:"white","font-size":10,"text-anchor":"end"},label));
  });
 }
 chart.data.datasets.forEach((dataset,index)=>{
  if(!chart.isDatasetVisible(index))return;
  const meta=chart.getDatasetMeta(index);const color=typeof dataset.borderColor==="string"?dataset.borderColor:"#38bdf8";
  let path="";let connected=false;
  meta.data.forEach((point,i)=>{const value=dataset.data[i];const p=point.getProps(["x","y"],true);if(value===null||value===undefined||!Number.isFinite(p.x)||!Number.isFinite(p.y)){connected=false;return;}path+=`${connected?"L":"M"}${p.x},${p.y} `;connected=true;svg.append(element("circle",{cx:p.x,cy:p.y,r:2,fill:color}));});
  svg.append(element("path",{d:path,stroke:color,fill:"none","stroke-width":2}));
  svg.append(element("text",{x:chart.chartArea.left+(index%3)*180,y:height-58+Math.floor(index/3)*12,fill:color,"font-size":10},dataset.label??""));
 });
 svg.append(element("text",{x:10,y:height-14,fill:"white","font-size":9},caption));
 return new XMLSerializer().serializeToString(svg);
}
export function downloadGraph(section:HTMLElement,caption:string,png=false){
 const text=sectionSvg(section,caption);if(!text)return;
 const name=section.querySelector("h2")?.textContent??"TEC graph";
 const url=URL.createObjectURL(new Blob([text],{type:"image/svg+xml"}));
 const a=document.createElement("a");
 if(!png){a.href=url;a.download=`${name}.svg`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}
 const img=new Image();img.onload=()=>{const canvas=document.createElement("canvas");canvas.width=2400;canvas.height=Math.round(2400*img.height/img.width);canvas.getContext("2d")?.drawImage(img,0,0,canvas.width,canvas.height);a.href=canvas.toDataURL("image/png");a.download=`${name}.png`;a.click();URL.revokeObjectURL(url);};img.onerror=()=>URL.revokeObjectURL(url);img.src=url;
}
export default function GraphExports({data}:{data:TecClimatology}){
 const root=useRef<HTMLDivElement>(null);
 const caption=`${data.start}–${data.end} | ${data.timezone} | TECU | ${data.contributing_stations} stations / ${data.observations} observations in selection | ${data.version}`;
 const run=(png=false)=>{const section=root.current?.closest("section");if(section)downloadGraph(section,caption,png);};
 return <div ref={root}><p>{caption}</p><button className="btn" onClick={()=>run()}>Graph SVG</button>{" "}<button className="btn" onClick={()=>run(true)}>Graph PNG (2400 px)</button></div>;
}
