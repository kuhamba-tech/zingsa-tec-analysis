import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
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
          Inline HostHoistable safety before any React/boot chunk.
          Prevents null.removeChild when Next swaps page metadata/scripts.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var H={TITLE:1,LINK:1,META:1,STYLE:1,SCRIPT:1};var n={removeChild:function(c){return c},insertBefore:function(a){return a},appendChild:function(a){return a}};var d=Object.getOwnPropertyDescriptor(Node.prototype,"parentNode");if(d&&d.get&&!Node.prototype.__zgiisParentNodePatched){var g=d.get;Object.defineProperty(Node.prototype,"parentNode",{configurable:true,get:function(){var p=g.call(this);if(p===null&&this.nodeName&&H[this.nodeName])return n;return p}});Node.prototype.__zgiisParentNodePatched=true}var r=Node.prototype.removeChild;Node.prototype.removeChild=function(c){if(!c||c.parentNode!==this)return c;return r.call(this,c)};var i=Node.prototype.insertBefore;Node.prototype.insertBefore=function(a,b){if(b&&b.parentNode!==this)return a;return i.call(this,a,b)}}catch(e){}})();`,
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
