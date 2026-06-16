"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV = [
  { href: "/",                  label: "Home",              icon: "🏠" },
  { href: "/dashboard",         label: "Dashboard",         icon: "📊" },
  { href: "/processing",        label: "Processing",        icon: "⚙️" },
  { href: "/time-series",       label: "Time Series",       icon: "📈" },
  { href: "/prn-explorer",      label: "PRN Explorer",      icon: "🛰️" },
  { href: "/tec-heatmap",       label: "TEC Heatmap",       icon: "🗺️" },
  { href: "/space-weather",     label: "Space Weather",     icon: "🌌" },
  { href: "/anomaly-detection", label: "Anomaly Detection", icon: "🔬" },
  { href: "/cors-hardware",     label: "CORS Hardware",     icon: "📡" },
  { href: "/vtec-theory",       label: "VTEC Theory",       icon: "📚" },
  { href: "/live-pipeline",     label: "Live Pipeline",     icon: "⚡" },
  { href: "/ai-assistant",      label: "AI Assistant",      icon: "🤖" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}>
      {/* Sidebar */}
      <aside style={{
        width: open ? "var(--sidebar-w)" : "56px",
        minWidth: open ? "var(--sidebar-w)" : "56px",
        background: "#000",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        transition: "width 0.2s, min-width 0.2s",
        overflow: "hidden",
        zIndex: 40,
        position: "sticky",
        top: 0,
        height: "100vh",
      }}>
        {/* Logo + collapse */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: open ? "space-between" : "center",
          padding: "1rem 0.8rem 0.75rem",
          borderBottom: "1px solid var(--border)",
        }}>
          {open && (
            <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#ffffff", letterSpacing: "0.05em" }}>
              GNSS-TEC
            </span>
          )}
          <button
            onClick={() => setOpen(!open)}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "1.1rem", lineHeight: 1 }}
            title={open ? "Collapse sidebar" : "Expand sidebar"}
          >
            {open ? "‹" : "›"}
          </button>
        </div>

        {/* Nav links */}
        <nav style={{ flex: 1, overflowY: "auto", padding: "0.5rem 0" }}>
          {NAV.map(({ href, label, icon }) => {
            const active = pathname === href;
            return (
              <Link key={href} href={href} style={{ textDecoration: "none" }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.65rem",
                  padding: "0.55rem 0.8rem",
                  margin: "1px 6px",
                  borderRadius: "7px",
                  background: active ? "#17367a" : "transparent",
                  borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
                  color: active ? "#fff" : "var(--text-muted)",
                  fontWeight: active ? 700 : 500,
                  fontSize: "0.84rem",
                  cursor: "pointer",
                  transition: "background 0.12s, color 0.12s",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}>
                  <span style={{ fontSize: "1rem", flexShrink: 0 }}>{icon}</span>
                  {open && <span>{label}</span>}
                </div>
              </Link>
            );
          })}
        </nav>

        {open && (
          <div className="sidebar-department">
            <img src="/zingsa_logo.webp" alt="ZINGSA Space Science Department" />
            <div>ZINGSA Space Science Department</div>
          </div>
        )}

        {/* Footer */}
        {open && (
          <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid var(--border)", fontSize: "0.65rem", color: "var(--text-muted)" }}>
            © 2026 ZINGSA
          </div>
        )}
      </aside>

      {/* Main */}
      <main style={{ flex: 1, overflowY: "auto", padding: "1.5rem 2rem", maxWidth: "1400px" }}>
        {children}
      </main>
    </div>
  );
}
