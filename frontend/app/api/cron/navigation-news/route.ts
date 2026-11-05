import { NextResponse } from "next/server";
import { ADVISORY_AUDIENCES, buildMeasuredAdvisory } from "@/lib/advisoryShare";
import { fetchSpaceWeatherBootstrap } from "@/lib/serverSpaceWeather";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 05:00 UTC daily bulletin. Builds the measured text and does not publish it. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, published: false }, { status: 401 });
  }

  const { sw, sa } = await fetchSpaceWeatherBootstrap();
  const bulletins = ADVISORY_AUDIENCES.map((audience) => {
    const card = buildMeasuredAdvisory(sw, sa, audience);
    return {
      audience: card.id,
      title: card.title,
      severity: card.severity,
      publishedLabel: card.publishedLabel,
      shareText: card.shareText,
    };
  });

  return NextResponse.json({
    ok: true,
    published: false,
    distribution: "disabled",
    reason:
      "Automatic Facebook and WhatsApp distribution stays off until an administrator approves a tested Meta connection.",
    generated_at_cat_schedule: "07:00 Africa/Harare",
    bulletins,
  });
}
