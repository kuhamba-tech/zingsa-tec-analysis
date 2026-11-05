import { advisoryImage } from "@/lib/advisoryImage";
import { loadMeasuredAdvisory } from "@/lib/loadMeasuredAdvisory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ audience: string }> },
) {
  const { audience } = await context.params;
  const card = await loadMeasuredAdvisory(audience);
  if (!card) return new Response("Advisory not found", { status: 404 });
  const image = advisoryImage(card);
  image.headers.set("Cache-Control", "public, max-age=300");
  return image;
}
