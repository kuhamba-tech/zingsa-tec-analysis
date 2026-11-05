import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdvisoryShareBar from "@/components/gnssIntelligence/AdvisoryShareBar";
import { ADVISORY_AUDIENCES, PUBLIC_SITE_ORIGIN, advisoryPath } from "@/lib/advisoryShare";
import { loadMeasuredAdvisory } from "@/lib/loadMeasuredAdvisory";

export function generateStaticParams() {
  return ADVISORY_AUDIENCES.map((audience) => ({ audience }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ audience: string }>;
}): Promise<Metadata> {
  const { audience } = await params;
  const card = await loadMeasuredAdvisory(audience);
  if (!card) return { title: "Navigation News — ZINGSA" };
  const description = `${card.headline} ${card.impact}`;
  return {
    title: `${card.title} — ZINGSA Navigation News`,
    description,
    openGraph: {
      title: `${card.title} — ZINGSA Navigation News`,
      description,
      url: card.url,
      type: "article",
      images: [
        {
          url: `${PUBLIC_SITE_ORIGIN}/api/navigation-news/${card.id}/image/`,
          width: 1200,
          height: 630,
          alt: `${card.title}, ${card.severity}`,
        },
      ],
    },
  };
}

export default async function NavigationAdvisoryPage({
  params,
}: {
  params: Promise<{ audience: string }>;
}) {
  const { audience } = await params;
  const card = await loadMeasuredAdvisory(audience);
  if (!card) notFound();

  return (
    <div className="page-stack">
      <header className="dashboard-header">
        <div>
          <p className="page-subtitle">ZINGSA Navigation News</p>
          <h1 className="page-title">{card.title}</h1>
        </div>
      </header>
      <article className="card advisory-sheet">
        <p>
          <strong>{card.category}</strong> · {card.severity} · {card.publishedLabel}
        </p>
        <p>{card.headline}</p>
        <h2>Measured conditions</h2>
        <ul>
          {card.indicators.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <h2>Possible impact</h2>
        <p>{card.impact}</p>
        <h2>What to do</h2>
        <p>{card.action}</p>
        <p>
          Full advisory: <Link href={advisoryPath(card.id)}>{card.url}</Link>
        </p>
        <AdvisoryShareBar card={card} />
      </article>
      <p>
        <Link href="/space-weather/gnss-intelligence/">Back to Navigation Weather</Link>
      </p>
    </div>
  );
}
