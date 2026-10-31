"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { withTrailingSlash } from "@/lib/withTrailingSlash";
import SiteTranslator from "./SiteTranslator";
import PageErrorBoundary from "./PageErrorBoundary";

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
      { href: "/storm-watch/", label: "Alerts", icon: "🔔" },
    ],
  },
  {
    section: "GNSS Processing",
    items: [
      { href: "/processing/#download", label: "RINEX Data", icon: "📥", matchHash: "#download" },
      { href: "/processing/#converter", label: "RINEX Processor", icon: "🔄", matchHash: "#converter" },
      { href: "/processing/", label: "TEC Processor", icon: "⚙️", excludeWhenHash: true },
      { href: "/prn-explorer/", label: "PRN Explorer", icon: "🛰️" },
      { href: "/time-series/", label: "Time Series", icon: "📈" },
    ],
  },
  {
    section: "Space Weather",
    items: [
      { href: "/space-weather/", label: "Live Space Weather", icon: "🌌" },
      { href: "/space-weather/gnss-intelligence/", label: "Navigation Weather", icon: "🛰️" },
      { href: "/anomaly-detection/", label: "TEC Anomaly", icon: "🔮" },
      { href: "/gic-monitor/", label: "GIC Monitor", icon: "🧲" },
      { href: "/storm-watch/", label: "Storm Watch", icon: "🌩️" },
    ],
  },
  {section:"Analysis Modules",items:[{href:"/tec-climatology/",label:"TEC Climatology",icon:"📊"}]},
  {
    section: "AI Intelligence",
    items: [
      { href: "/ai-assistant/", label: "AI Assistant", icon: "🤖" },
      { href: "/live-pipeline/", label: "Live Pipeline", icon: "⚡" },
    ],
  },
  {
    section: "Infrastructure",
    items: [
      { href: "/#cors-network", label: "CORS Network", icon: "🗺️", matchHash: "#cors-network" },
      { href: "/cors-hardware/", label: "CORS Hardware", icon: "📡" },
    ],
  },
  {
    section: "Reports",
    items: [
      { href: "/reports/?period=daily", label: "Space Weather Reports", icon: "📅", matchQuery: "period=" },
      { href: "/reports/?type=uptime&range=1w", label: "Station Uptime", icon: "📶", matchQuery: "type=uptime" },
    ],
  },
  {
    section: "Education",
    items: [
      { href: "/understanding-tec/", label: "Understanding TEC", icon: "🌐" },
      { href: "/vtec-theory/", label: "Calculating TEC", icon: "📚" },
      { href: "/geomagnetic-storm-theory/", label: "Storm Theory", icon: "📐" },
    ],
  },
];

function navPath(href: string) {
  const raw = href.split(/[?#]/)[0] || "/";
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw;
}

function navHash(href: string) {
  const i = href.indexOf("#");
  return i >= 0 ? href.slice(i) : "";
}

function normalizePathname(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname || "/";
}

function isNavActive(
  pathname: string,
  locationHash: string,
  searchQuery: string,
  item: NavItem,
  groupItems: NavItem[],
): boolean {
  const path = navPath(item.href);
  const here = normalizePathname(pathname);
  const hash = item.matchHash ?? navHash(item.href);

  if (item.matchQuery) {
    // Prefer the most specific Reports sibling when both path-match (e.g. type=uptime vs period=).
    if (here !== path) return false;
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
    return here === path && locationHash === item.matchHash;
  }

  if (item.excludeWhenHash) {
    const siblingHashActive = groupItems.some(
      (s) => s.matchHash && here === navPath(s.href) && locationHash === s.matchHash,
    );
    if (siblingHashActive) return false;
  }

  if (path === "/") return here === "/";
  if (here === path) return !hash || locationHash === hash;
  return pathname.startsWith(`${path}/`);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchQuery = searchParams.toString();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [locationHash, setLocationHash] = useState("");

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, searchQuery]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const sync = () => {
      setMobileViewport(media.matches);
      if (!media.matches) setMobileOpen(false);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("mobile-nav-open", mobileOpen);
    return () => document.body.classList.remove("mobile-nav-open");
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const sidebar = sidebarRef.current;
    sidebar?.querySelector<HTMLElement>(".app-mobile-close")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
      }
      if (event.key !== "Tab" || !sidebar) return;
      const stops = [menuRef.current, ...sidebar.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex="0"]',
      )].filter((element): element is HTMLElement => Boolean(element?.getClientRects().length));
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const returnFocus = menuRef.current?.getClientRects().length ? menuRef.current : previousFocus;
      if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus();
    };
  }, [mobileOpen]);

  useEffect(() => {
    const sync = () => setLocationHash(window.location.hash);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [pathname]);

  // Warm the live space-weather cache without waiting on the heavy api.ts chunk.
  useEffect(() => {
    void import("@/lib/bootSpaceWeather").then(({ bootSpaceWeather }) => {
      void bootSpaceWeather();
    });
  }, []);

  // Clipboard / Event rejections must not open the Next.js runtime overlay
  // (that freezes the National Dashboard on Unavailable / Loading…).
  useEffect(() => {
    let dispose: (() => void) | undefined;
    void import("@/lib/safeClipboard").then(({ installClientRejectionGuards }) => {
      dispose = installClientRejectionGuards();
    });
    return () => dispose?.();
  }, []);

  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="app-shell">
      <a className="app-skip-link" href="#app-content" onClick={(event) => {
        event.preventDefault();
        mainRef.current?.focus();
      }}>Skip to content</a>
      <header className="app-topbar">
        <button
          ref={menuRef}
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
        ref={sidebarRef}
        id="app-navigation"
        aria-label="Main navigation"
        inert={mobileViewport && !mobileOpen}
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
                    href={withTrailingSlash(item.href)}
                    className="app-nav-link"
                    prefetch={false}
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
            <Image
              src="/zingsa_logo.webp"
              alt="ZINGSA Space Science Department"
              width={48}
              height={48}
              sizes="48px"
            />
            <div>ZINGSA Space Science Department</div>
          </div>

          <div className="app-sidebar-footer">© 2026 ZINGSA</div>
        </div>
      </aside>

      <main ref={mainRef} id="app-content" className="app-main" tabIndex={-1} inert={mobileOpen}>
        <PageErrorBoundary key={pathname}>{children}</PageErrorBoundary>
      </main>
      <div inert={mobileOpen}><SiteTranslator /></div>
    </div>
  );
}
