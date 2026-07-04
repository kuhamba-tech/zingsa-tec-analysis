"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** When set, only active if location hash matches (e.g. #converter on /processing). */
  matchHash?: string;
  /** When true, do not highlight if a sibling item with matchHash is active. */
  excludeWhenHash?: boolean;
};

const NAV_GROUPS: { section: string; items: NavItem[] }[] = [
  {
    section: "Overview",
    items: [
      { href: "/", label: "Home", icon: "🏠" },
      { href: "/dashboard", label: "Dashboard", icon: "📊" },
    ],
  },
  {
    section: "Analysis",
    items: [
      { href: "/processing", label: "Processing", icon: "⚙️", excludeWhenHash: true },
      { href: "/processing#converter", label: "RINEX Converter", icon: "🔄", matchHash: "#converter" },
      { href: "/time-series", label: "Time Series", icon: "📈" },
      { href: "/prn-explorer", label: "PRN Explorer", icon: "🛰️" },
      { href: "/tec-heatmap", label: "TEC Heatmap", icon: "🗺️" },
      { href: "/anomaly-detection", label: "Anomaly Detection", icon: "🔬" },
    ],
  },
  {
    section: "Space Weather",
    items: [
      { href: "/space-weather", label: "Space Weather", icon: "🌌" },
      { href: "/space-weather/gnss-intelligence", label: "Navigation Weather", icon: "🛰️" },
      { href: "/storm-watch", label: "Storm Watch", icon: "🌩️" },
      { href: "/gic-monitor", label: "GIC Monitor", icon: "🧲" },
      { href: "/understanding-tec", label: "Understanding TEC", icon: "🌐" },
      { href: "/vtec-theory", label: "Calculating VTEC", icon: "📚" },
      { href: "/geomagnetic-storm-theory", label: "Storm Metrics Theory", icon: "🧲" },
    ],
  },
  {
    section: "Network",
    items: [
      { href: "/cors-hardware", label: "CORS Hardware", icon: "📡" },
      { href: "/live-pipeline", label: "Live Pipeline", icon: "⚡" },
    ],
  },
  {
    section: "Tools",
    items: [
      { href: "/ai-assistant", label: "AI Assistant", icon: "🤖" },
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

function isNavActive(pathname: string, locationHash: string, item: NavItem, groupItems: NavItem[]): boolean {
  const path = navPath(item.href);
  const hash = item.matchHash ?? navHash(item.href);

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
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [locationHash, setLocationHash] = useState("");

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

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
        <span className="app-topbar-title">GNSS-TEC</span>
      </header>

      {mobileOpen && <div className="app-overlay" onClick={closeMobile} />}

      <aside
        id="app-navigation"
        className={`app-sidebar${collapsed ? " is-collapsed" : ""}${mobileOpen ? " is-mobile-open" : ""}`}
      >
        <div className="app-sidebar-head">
          <span className="app-logo-text">GNSS-TEC</span>
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
                const active = isNavActive(pathname, locationHash, item, items);
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

        <div className="sidebar-department">
          <img src="/zingsa_logo.webp" alt="ZINGSA Space Science Department" />
          <div>ZINGSA Space Science Department</div>
        </div>

        <div className="app-sidebar-footer">© 2026 ZINGSA</div>
      </aside>

      <main className="app-main">
        {children}
      </main>
    </div>
  );
}
