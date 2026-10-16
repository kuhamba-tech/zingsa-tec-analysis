/**
 * Same-origin proxy to FastAPI for Cursor / cloud previews.
 *
 * Browser → /api/zgiis/... → 127.0.0.1:8000/...
 * Avoids fragile /backend rewrites when the preview ingress authenticates
 * the HTML document but client fetches still need a real Next route.
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPSTREAM = (
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://127.0.0.1:8000"
).replace(/\/$/, "");

async function proxy(req: NextRequest, pathParts: string[]) {
  const path = pathParts.map(encodeURIComponent).join("/");
  const url = new URL(req.url);
  const target = `${UPSTREAM}/${path}${url.search}`;

  const headers = new Headers();
  const apiKey = req.headers.get("x-api-key") || process.env.NEXT_PUBLIC_API_KEY;
  if (apiKey) headers.set("X-API-Key", apiKey);
  const accept = req.headers.get("accept");
  if (accept) headers.set("Accept", accept);
  headers.set("User-Agent", "ZGIIS-Next-Proxy/1.0");

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
    redirect: "manual",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
    const ct = req.headers.get("content-type");
    if (ct) headers.set("Content-Type", ct);
  }

  try {
    const upstream = await fetch(target, init);
    const body = await upstream.arrayBuffer();
    const out = new NextResponse(body, { status: upstream.status });
    const contentType = upstream.headers.get("content-type");
    if (contentType) out.headers.set("Content-Type", contentType);
    // Short private cache for hot graph/metric GETs — cuts repeat proxy latency.
    const joined = pathParts.join("/");
    const shortCache =
      req.method === "GET" &&
      /^(space-weather\/(current|timelines|heliospheric-monitor|solar-activity|ekf)|cors\/stations|live\/vtec-by-station)/.test(
        joined,
      );
    out.headers.set(
      "Cache-Control",
      shortCache ? "private, max-age=8, stale-while-revalidate=24" : "no-store",
    );
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "upstream_unreachable", detail: message },
      { status: 502 },
    );
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path);
}
