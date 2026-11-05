import { NextResponse } from "next/server";
import { isAdvisoryAudience } from "@/lib/advisoryShare";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NOT_ENABLED =
  "WhatsApp alerts are not switched on. ZINGSA has not connected an approved WhatsApp Business template, so this number was not saved and no message will be sent. Use Share on WhatsApp to send an advisory yourself.";

export async function POST(request: Request) {
  let body: { phone?: unknown; consent?: unknown; audience?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ stored: false, notified: false, message: "The form could not be read." }, { status: 400 });
  }

  const phone = String(body.phone ?? "").replace(/[^\d+]/g, "");
  const audience = String(body.audience ?? "");
  if (!isAdvisoryAudience(audience)) {
    return NextResponse.json({ stored: false, notified: false, message: "Choose a navigation advisory." }, { status: 400 });
  }
  if (body.consent !== true) {
    return NextResponse.json(
      { stored: false, notified: false, message: "Consent is required. This number was not saved." },
      { status: 400 },
    );
  }
  if (!/^\+?[1-9]\d{7,14}$/.test(phone)) {
    return NextResponse.json(
      { stored: false, notified: false, message: "Enter a telephone number with the country code. Nothing was saved." },
      { status: 400 },
    );
  }

  // Delivery stays off until an administrator connects the official Cloud API.
  // The number is not written to a database and is not forwarded to Meta.
  return NextResponse.json(
    { stored: false, notified: false, accepted: false, message: NOT_ENABLED },
    { status: 503 },
  );
}
