import { cronApiOrigin } from "@/lib/cronOrigin";
import { kpAdvisoryImage } from "@/lib/kpAdvisoryImage";
import type { HeliosphericMonitorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

export async function GET() {
  const path = "/space-weather/heliospheric-monitor";
  const target = process.env.VERCEL === "1"
    ? `${cronApiOrigin()}/api/space-weather-router/?__zr=${encodeURIComponent(path)}`
    : `${(process.env.ZGIIS_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "")}${path}`;
  const apiKey = process.env.API_KEY || process.env.NEXT_PUBLIC_API_KEY;

  try {
    const response = await fetch(target, {
      cache: "no-store",
      headers: apiKey ? { "X-API-Key": apiKey } : undefined,
      signal: AbortSignal.timeout(35_000),
    });
    if (!response.ok) return new Response("Planetary Kp service unavailable", { status: 502 });
    const data: HeliosphericMonitorResponse = await response.json();
    return kpAdvisoryImage(data) ?? new Response("Planetary Kp observations unavailable", { status: 503 });
  } catch {
    return new Response("Planetary Kp service unavailable", { status: 502 });
  }
}
