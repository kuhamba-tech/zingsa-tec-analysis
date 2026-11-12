import { NextResponse } from "next/server";
import { cronApiOrigin } from "@/lib/cronOrigin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Live ZESA advisory every 15 minutes.
 * 13:00 Zimbabwe time is 11:00 UTC, and every quarter-hour after that.
 * The daily briefs at 06:00, 12:00, 18:00 and 00:00 CAT stay on their own schedule.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, sent: false }, { status: 401 });
  }

  const target = `${cronApiOrigin()}/api/space-weather-router/?__zr=${encodeURIComponent("/space-weather/power-grid-advisory/dispatch?brief=true")}`;
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
    const delivered = response.ok && body?.ok === true && body?.detail === "slack sent";
    const outcome = {
      delivered,
      backendStatus: response.status,
      detail: typeof body?.detail === "string" ? body.detail : "No delivery confirmation from backend",
      issuedCat: body?.issued_cat ?? null,
    };
    if (delivered) console.info("15-minute Slack delivery", outcome);
    else console.error("15-minute Slack delivery failed", outcome);
    return NextResponse.json(
      {
        ok: response.ok && body?.ok === true,
        sent: delivered,
        status: response.status,
        level: body?.level ?? null,
        detail: body?.detail ?? null,
        issued_cat: body?.issued_cat ?? null,
      },
      { status: delivered ? 200 : 502 },
    );
  } catch (error) {
    console.error("15-minute Slack request failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json(
      {
        ok: false,
        sent: false,
        error: error instanceof Error ? error.message : "15-minute advisory failed",
      },
      { status: 502 },
    );
  }
}
