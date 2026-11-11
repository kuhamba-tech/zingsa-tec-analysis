import { NextResponse } from "next/server";
import { cronApiOrigin } from "@/lib/cronOrigin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Posts the live ZESA / ZETDC power-grid advisory to Slack.
 * Vercel runs this four times a day at 06:00, 12:00, 18:00 and 00:00 CAT.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, sent: false }, { status: 401 });
  }

  const target = `${cronApiOrigin()}/api/space-weather-router/?__zr=${encodeURIComponent("/space-weather/power-grid-advisory/dispatch")}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = process.env.API_KEY || process.env.NEXT_PUBLIC_API_KEY;
  if (apiKey) headers["X-API-Key"] = apiKey;
  if (secret) headers["X-Cron-Secret"] = secret;

  try {
    const response = await fetch(target, {
      method: "POST",
      headers,
      cache: "no-store",
      redirect: "manual",
    });
    const body = await response.json().catch(() => null);
    return NextResponse.json(
      {
        ok: response.ok && body?.ok === true,
        sent: body?.ok === true,
        status: response.status,
        level: body?.level ?? null,
        detail: body?.detail ?? null,
        issued_cat: body?.issued_cat ?? null,
      },
      { status: response.ok ? 200 : 502 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        sent: false,
        error: error instanceof Error ? error.message : "power-grid advisory failed",
      },
      { status: 502 },
    );
  }
}
