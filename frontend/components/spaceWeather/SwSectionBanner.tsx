import type { ReactNode } from "react";

type FeedTone = "ok" | "warn" | "off";

interface Props {
  /** Section title — rendered uppercase via CSS. */
  title: string;
  /** Optional leading emoji / icon glyph. */
  icon?: string;
  /** Optional id for the heading element (accessibility). */
  titleId?: string;
  /** Right-side status / actions (live label, links, range controls). */
  meta?: ReactNode;
  /** Show a status dot before meta text. */
  tone?: FeedTone;
  /** Heading level — default h2. */
  as?: "h2" | "h3" | "div";
  className?: string;
}

/**
 * Shared Space Weather section banner — matches Solar Activity Monitor:
 * dark rounded bar, icon + uppercase title left, status/meta right.
 */
export default function SwSectionBanner({
  title,
  icon,
  titleId,
  meta,
  tone,
  as = "h2",
  className = "",
}: Props) {
  const HeadingTag = as;
  return (
    <div className={`sw-section-banner${className ? ` ${className}` : ""}`}>
      <div className="sw-section-banner-left">
        {icon ? (
          <span className="sw-section-banner-icon" aria-hidden>
            {icon}
          </span>
        ) : null}
        <HeadingTag id={titleId} className="sw-section-banner-title">
          {title}
        </HeadingTag>
      </div>
      {(meta != null || tone) && (
        <div className="sw-section-banner-meta">
          {tone ? (
            <span
              className={`dot ${tone === "ok" ? "dot-ok" : tone === "warn" ? "dot-warn" : "dot-off"}`}
              aria-hidden
            />
          ) : null}
          {meta}
        </div>
      )}
    </div>
  );
}
