import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-side early-warning evaluation.
 * Runs on a schedule so alerts are generated even when no browser is open.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, evaluated: false }, { status: 401 });
  }

  const origin = new URL(request.url).origin;
  const target = `${origin}/api/space-weather-router/?__zr=${encodeURIComponent("/space-weather/early-warning/evaluate")}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = process.env.API_KEY || process.env.NEXT_PUBLIC_API_KEY;
  if (apiKey) headers["X-API-Key"] = apiKey;

  try {
    const response = await fetch(target, {
      method: "POST",
      headers,
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    return NextResponse.json(
      {
        ok: response.ok,
        evaluated: response.ok,
        status: response.status,
        summary: body?.summary ?? null,
        diagnostics: body?.diagnostics ?? null,
      },
      { status: response.ok ? 200 : 502 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        evaluated: false,
        error: error instanceof Error ? error.message : "early-warning evaluate failed",
      },
      { status: 502 },
    );
  }
}
