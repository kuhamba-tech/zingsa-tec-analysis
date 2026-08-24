"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import SiteTranslator from "./SiteTranslator";
import PageErrorBoundary from "./PageErrorBoundary";
import { getSpaceWeather, getStations } from "@/lib/api";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** When set, only active if location hash matches (e.g. #converter on /processing). */
  matchHash?: string;
  /** When true, do not highlight if a sibling item with matchHash is active. */
  excludeWhenHash?: boolean;
  /** When set, only active if the query string contains this substring (e.g. period=daily). */
  matchQuery?: string;
};

const NAV_GROUPS: { section: string; items: NavItem[] }[] = [
  {
    section: "Dashboard",
    items: [
      { href: "/", label: "National Dashboard", icon: "🇿🇼", excludeWhenHash: true },
      { href: "/#cors-network", label: "Live CORS", icon: "📡", matchHash: "#cors-network" },
      { href: "/storm-watch", label: "Alerts", icon: "🔔" },
    ],
  },
  {
    section: "GNSS Processing",
    items: [
      { href: "/processing#download", label: "RINEX Data", icon: "📥", matchHash: "#download" },
      { href: "/processing#converter", label: "RINEX Processor", icon: "🔄", matchHash: "#converter" },
      { href: "/processing", label: "TEC Processor", icon: "⚙️", excludeWhenHash: true },
      { href: "/prn-explorer", label: "PRN Explorer", icon: "🛰️" },
      { href: "/time-series", label: "Time Series", icon: "📈" },
    ],
  },
  {
    section: "Space Weather",
    items: [
      { href: "/space-weather", label: "Live Space Weather", icon: "🌌" },
      { href: "/space-weather/gnss-intelligence", label: "Navigation Weather", icon: "🛰️" },
      { href: "/anomaly-detection", label: "TEC Anomaly", icon: "🔮" },
      { href: "/gic-monitor", label: "GIC Monitor", icon: "🧲" },
      { href: "/storm-watch", label: "Storm Watch", icon: "🌩️" },
    ],
  },
  {
    section: "AI Intelligence",
    items: [
      { href: "/ai-assistant", label: "AI Assistant", icon: "🤖" },
      { href: "/live-pipeline", label: "Live Pipeline", icon: "⚡" },
    ],
  },
  {
    section: "Infrastructure",
    items: [
      { href: "/#cors-network", label: "CORS Network", icon: "🗺️", matchHash: "#cors-network" },
      { href: "/cors-hardware", label: "CORS Hardware", icon: "📡" },
    ],
  },
  {
    section: "Reports",
    items: [
      { href: "/reports?period=daily", label: "Space Weather Reports", icon: "📅", matchQuery: "period=" },
      { href: "/reports?type=uptime&range=1w", label: "Station Uptime", icon: "📶", matchQuery: "type=uptime" },
    ],
  },
  {
    section: "Education",
    items: [
      { href: "/understanding-tec", label: "Understanding TEC", icon: "🌐" },
      { href: "/vtec-theory", label: "Calculating TEC", icon: "📚" },
      { href: "/geomagnetic-storm-theory", label: "Storm Theory", icon: "📐" },
    ],
  },
];

function navPath(href: string) {
  return href.split("#")[0];
}

function navHash(href: string) {
  const i = href.indexOf("#");
  return i >= 0 ? href.slice(i) : "";
}

function isNavActive(
  pathname: string,
  locationHash: string,
  searchQuery: string,
  item: NavItem,
  groupItems: NavItem[],
): boolean {
  const path = navPath(item.href);
  const hash = item.matchHash ?? navHash(item.href);

  if (item.matchQuery) {
    // Prefer the most specific Reports sibling when both path-match (e.g. type=uptime vs period=).
    if (pathname !== path) return false;
    if (!searchQuery.includes(item.matchQuery)) return false;
    const moreSpecificSibling = groupItems.some(
      (s) =>
        s !== item &&
        s.matchQuery &&
        searchQuery.includes(s.matchQuery) &&
        s.matchQuery.length > item.matchQuery!.length,
    );
    return !moreSpecificSibling;
  }

  if (item.matchHash) {
    return pathname === path && locationHash === item.matchHash;
  }

  if (item.excludeWhenHash) {
    const siblingHashActive = groupItems.some(
      (s) => s.matchHash && pathname === navPath(s.href) && locationHash === s.matchHash,
    );
    if (siblingHashActive) return false;
  }

  if (path === "/") return pathname === "/";
  if (pathname === path) return !hash || locationHash === hash;
  return pathname.startsWith(`${path}/`);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchQuery = searchParams.toString();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [locationHash, setLocationHash] = useState("");

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    void getSpaceWeather().catch(() => null);
    void getStations(false).catch(() => null);
  }, [pathname]);

  useEffect(() => {
    document.body.classList.toggle("mobile-nav-open", mobileOpen);
    return () => document.body.classList.remove("mobile-nav-open");
  }, [mobileOpen]);

  useEffect(() => {
    const sync = () => setLocationHash(window.location.hash);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [pathname]);

  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <button
          className="app-hamburger"
          onClick={() => setMobileOpen((open) => !open)}
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileOpen}
          aria-controls="app-navigation"
        >
          <span className="app-hamburger-icon" aria-hidden="true">☰</span>
          <span className="app-hamburger-label">{mobileOpen ? "Close" : "Menu"}</span>
        </button>
        <span className="app-topbar-title">Space Weather &amp; Navigation</span>
      </header>

      {mobileOpen && <div className="app-overlay" onClick={closeMobile} />}

      <aside
        id="app-navigation"
        className={`app-sidebar${collapsed ? " is-collapsed" : ""}${mobileOpen ? " is-mobile-open" : ""}`}
      >
        <div className="app-sidebar-head">
          <span className="app-logo-text">Space Weather &amp; Navigation</span>
          <button
            className="app-collapse-btn"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
          >
            {collapsed ? "›" : "‹"}
          </button>
          <button className="app-mobile-close" onClick={closeMobile} aria-label="Close navigation">✕</button>
        </div>

        <nav className="app-nav">
          {NAV_GROUPS.map(({ section, items }) => (
            <div key={section} className="app-nav-group">
              <div className="app-nav-section">{section}</div>
              {items.map((item) => {
                const active = isNavActive(pathname, locationHash, searchQuery, item, items);
                return (
                  <Link
                    key={`${item.href}-${item.label}`}
                    href={item.href}
                    className="app-nav-link"
                    onClick={closeMobile}
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? item.label : undefined}
                  >
                    <div className={`app-nav-item${active ? " is-active" : ""}${item.matchHash ? " app-nav-item--sub" : ""}`}>
                      <span className="app-nav-icon">{item.icon}</span>
                      <span className="app-nav-label">{item.label}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-department">
            <img src="/zingsa_logo.webp" alt="ZINGSA Space Science Department" />
            <div>ZINGSA Space Science Department</div>
          </div>

          <div className="app-sidebar-footer">© 2026 ZINGSA</div>
        </div>
      </aside>

      <main className="app-main">
        <PageErrorBoundary key={pathname}>{children}</PageErrorBoundary>
      </main>
      <SiteTranslator />
    </div>
  );
}
