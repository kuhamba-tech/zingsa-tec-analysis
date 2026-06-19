"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV_GROUPS = [
  {
    section: "Overview",
    items: [
      { href: "/",          label: "Home",      icon: "🏠" },
      { href: "/dashboard",  label: "Dashboard", icon: "📊" },
    ],
  },
  {
    section: "Analysis",
    items: [
      { href: "/processing",        label: "Processing",        icon: "⚙️" },
      { href: "/time-series",       label: "Time Series",       icon: "📈" },
      { href: "/prn-explorer",      label: "PRN Explorer",      icon: "🛰️" },
      { href: "/tec-heatmap",       label: "TEC Heatmap",       icon: "🗺️" },
      { href: "/anomaly-detection", label: "Anomaly Detection", icon: "🔬" },
    ],
  },
  {
    section: "Space Weather",
    items: [
      { href: "/space-weather", label: "Space Weather", icon: "🌌" },
      { href: "/vtec-theory",   label: "VTEC Theory",   icon: "📚" },
    ],
  },
  {
    section: "Network",
    items: [
      { href: "/cors-hardware", label: "CORS Hardware", icon: "📡" },
      { href: "/live-pipeline", label: "Live Pipeline",  icon: "⚡" },
    ],
  },
  {
    section: "Tools",
    items: [
      { href: "/ai-assistant", label: "AI Assistant", icon: "🤖" },
    ],
  },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer on route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="app-shell">
      {/* Mobile top bar */}
      <header className="app-topbar">
        <button className="app-hamburger" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
          <span /><span /><span />
        </button>
        <span className="app-topbar-title">GNSS-TEC</span>
      </header>

      {/* Backdrop (mobile only, shown while drawer is open) */}
      {mobileOpen && <div className="app-overlay" onClick={closeMobile} />}

      {/* Sidebar */}
      <aside className={`app-sidebar${collapsed ? " is-collapsed" : ""}${mobileOpen ? " is-mobile-open" : ""}`}>
        <div className="app-sidebar-head">
          <span className="app-logo-text">GNSS-TEC</span>
          <button
            className="app-collapse-btn"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? "›" : "‹"}
          </button>
          <button className="app-mobile-close" onClick={closeMobile} aria-label="Close navigation">✕</button>
        </div>

        <nav className="app-nav">
          {NAV_GROUPS.map(({ section, items }) => (
            <div key={section} className="app-nav-group">
              <div className="app-nav-section">{section}</div>
              {items.map(({ href, label, icon }) => {
                const active = pathname === href;
                return (
                  <Link key={href} href={href} className="app-nav-link">
                    <div className={`app-nav-item${active ? " is-active" : ""}`}>
                      <span className="app-nav-icon">{icon}</span>
                      <span className="app-nav-label">{label}</span>
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

      {/* Main */}
      <main className="app-main">
        {children}
      </main>
    </div>
  );
}
