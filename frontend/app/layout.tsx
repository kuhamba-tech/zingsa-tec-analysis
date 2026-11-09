import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import Script from "next/script";
import "./globals.css";
import AppShell from "@/components/layout/AppShell";
import ChunkLoadRecovery from "@/components/ChunkLoadRecovery";
import RouterFetchRecovery from "@/components/RouterFetchRecovery";
import SpaceWeatherBootScript from "@/components/SpaceWeatherBootScript";

export const metadata: Metadata = {
  title: "Zimbabwe Space Weather & Navigation",
  description: "Real-time space weather, ionospheric TEC, and GNSS navigation from Zimbabwe's CORS network",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Next-managed compatibility scripts run before any React/boot chunk.
          Prevents null.removeChild when Next swaps page metadata/scripts.
        */}
        <Script
          id="zgiis-dom-hoist-compat"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var H={TITLE:1,LINK:1,META:1,STYLE:1,SCRIPT:1};var n={removeChild:function(c){return c},insertBefore:function(a){return a},appendChild:function(a){return a}};var d=Object.getOwnPropertyDescriptor(Node.prototype,"parentNode");if(d&&d.get&&!Node.prototype.__zgiisParentNodePatched){var g=d.get;Object.defineProperty(Node.prototype,"parentNode",{configurable:true,get:function(){var p=g.call(this);if(p===null&&this.nodeName&&H[this.nodeName])return n;return p}});Node.prototype.__zgiisParentNodePatched=true}var r=Node.prototype.removeChild;Node.prototype.removeChild=function(c){if(!c||c.parentNode!==this)return c;return r.call(this,c)};var i=Node.prototype.insertBefore;Node.prototype.insertBefore=function(a,b){if(b&&b.parentNode!==this)return a;return i.call(this,a,b)}}catch(e){}})();`,
          }}
        />
        <Script
          id="zgiis-cursor-attribute-compat"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{function cursorName(name){return name==="data-cursor-ref"}var setAttr=Element.prototype.setAttribute;Element.prototype.setAttribute=function(name,value){if(cursorName(name))return;return setAttr.call(this,name,value)};var setAttrNS=Element.prototype.setAttributeNS;Element.prototype.setAttributeNS=function(ns,name,value){if(cursorName(name))return;return setAttrNS.call(this,ns,name,value)};var setNode=Element.prototype.setAttributeNode;Element.prototype.setAttributeNode=function(attr){if(attr&&cursorName(attr.name))return attr;return setNode.call(this,attr)};function strip(node){if(!node||node.nodeType!==1)return;if(node.hasAttribute&&node.hasAttribute("data-cursor-ref"))node.removeAttribute("data-cursor-ref");if(!node.querySelectorAll)return;var list=node.querySelectorAll("[data-cursor-ref]");for(var i=0;i<list.length;i++)list[i].removeAttribute("data-cursor-ref")}if(typeof MutationObserver==="undefined")return;var obs=new MutationObserver(function(records){for(var i=0;i<records.length;i++){var rec=records[i];if(rec.type==="attributes")strip(rec.target);var added=rec.addedNodes;for(var j=0;j<added.length;j++)strip(added[j])}});obs.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["data-cursor-ref"]});var stop=function(){obs.disconnect()};window.addEventListener("load",function(){setTimeout(stop,8000)})}catch(e){}})();`,
          }}
        />
        {/* Static boot runs before app/layout.js — includes ChunkLoadError recovery */}
        <SpaceWeatherBootScript />
      </head>
      <body suppressHydrationWarning>
        <ChunkLoadRecovery />
        <RouterFetchRecovery />
        <Suspense fallback={<div className="app-main">{children}</div>}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
