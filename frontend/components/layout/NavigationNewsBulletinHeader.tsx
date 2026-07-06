import Link from "next/link";
import {
  NAVIGATION_NEWS_SERIES_TAGLINE,
  NAVIGATION_NEWS_SERIES_TITLE,
} from "@/lib/navigationNewsBranding";

interface NavigationNewsBulletinHeaderProps {
  updatedLabel?: string | null;
  showUpdated?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  fullBriefsHref?: string;
}

export default function NavigationNewsBulletinHeader({
  updatedLabel,
  showUpdated = true,
  collapsed = false,
  onToggleCollapsed,
  fullBriefsHref = "/space-weather/gnss-intelligence/",
}: NavigationNewsBulletinHeaderProps) {
  return (
    <header className="nav-news-bulletin-header">
      <div className="nav-news-bulletin-brand">
        <h2 className="nav-news-bulletin-title">{NAVIGATION_NEWS_SERIES_TITLE}</h2>
        <p className="nav-news-bulletin-tagline">{NAVIGATION_NEWS_SERIES_TAGLINE}</p>
      </div>
      <div className="nav-news-bulletin-actions">
        {showUpdated && updatedLabel && (
          <span className="nav-news-bulletin-updated">Updated {updatedLabel}</span>
        )}
        <Link href={fullBriefsHref} className="nav-news-bulletin-link">
          Full briefs
        </Link>
        {onToggleCollapsed && (
          <button
            type="button"
            className="nav-news-bulletin-toggle"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
          >
            {collapsed ? "Show" : "Hide"}
          </button>
        )}
      </div>
    </header>
  );
}
