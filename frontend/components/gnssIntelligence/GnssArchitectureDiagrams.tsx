"use client";

function FlowArrow({ className }: { className?: string }) {
  return (
    <svg className={className ?? "gnwi-flow-arrow"} viewBox="0 0 24 48" aria-hidden>
      <line x1="12" y1="4" x2="12" y2="36" stroke="currentColor" strokeWidth="2" />
      <polygon points="12,44 6,34 18,34" fill="currentColor" />
    </svg>
  );
}

function FlowFork({ className }: { className?: string }) {
  return (
    <svg className={className ?? "gnwi-flow-fork"} viewBox="0 0 320 56" aria-hidden>
      <line x1="160" y1="4" x2="160" y2="20" stroke="currentColor" strokeWidth="2" />
      <line x1="56" y1="20" x2="264" y2="20" stroke="currentColor" strokeWidth="2" />
      <line x1="56" y1="20" x2="56" y2="48" stroke="currentColor" strokeWidth="2" />
      <line x1="264" y1="20" x2="264" y2="48" stroke="currentColor" strokeWidth="2" />
      <polygon points="56,52 50,42 62,42" fill="currentColor" />
      <polygon points="264,52 258,42 270,42" fill="currentColor" />
    </svg>
  );
}

function FlowMerge({ className }: { className?: string }) {
  return (
    <svg className={className ?? "gnwi-flow-merge"} viewBox="0 0 320 56" aria-hidden>
      <line x1="56" y1="4" x2="56" y2="16" stroke="currentColor" strokeWidth="2" />
      <line x1="264" y1="4" x2="264" y2="16" stroke="currentColor" strokeWidth="2" />
      <line x1="56" y1="16" x2="264" y2="16" stroke="currentColor" strokeWidth="2" />
      <line x1="160" y1="16" x2="160" y2="48" stroke="currentColor" strokeWidth="2" />
      <polygon points="160,52 154,42 166,42" fill="currentColor" />
    </svg>
  );
}

function NodeCard({
  icon,
  title,
  subtitle,
  accent,
  glow,
  size = "md",
}: {
  icon: string;
  title: string;
  subtitle?: string;
  accent: string;
  glow?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <div
      className={`gnwi-node gnwi-node--${size}`}
      style={{
        borderColor: accent,
        boxShadow: glow ? `0 0 24px ${glow}` : undefined,
        background: `linear-gradient(145deg, ${accent}18 0%, #06111f 55%)`,
      }}
    >
      <span className="gnwi-node-icon" aria-hidden>
        {icon}
      </span>
      <div className="gnwi-node-text">
        <div className="gnwi-node-title">{title}</div>
        {subtitle && <div className="gnwi-node-sub">{subtitle}</div>}
      </div>
    </div>
  );
}

/** Visual data-fusion pipeline (replaces ASCII diagram 1). */
export function DataFusionPipelineDiagram() {
  return (
    <div className="gnwi-diagram gnwi-diagram--fusion" aria-label="Data fusion pipeline architecture">
      <div className="gnwi-diagram-header">Data fusion pipeline</div>
      <div className="gnwi-diagram-body">
        <div className="gnwi-diagram-col gnwi-diagram-col--center">
          <NodeCard icon="☀️" title="SUN" subtitle="Solar activity source" accent="#f59e0b" glow="rgba(245,158,11,0.25)" />
          <FlowArrow />
          <NodeCard icon="📡" title="Solar Activity Data" subtitle="Flares · CME · wind drivers" accent="#eab308" />
          <FlowFork />
        </div>

        <div className="gnwi-diagram-split">
          <NodeCard
            icon="🌌"
            title="NOAA / Space Weather"
            subtitle="Kp · Dst · Solar wind"
            accent="#168bd2"
            glow="rgba(22,139,210,0.2)"
          />
          <NodeCard
            icon="🇿🇼"
            title="Zimbabwe CORS"
            subtitle="TEC · GNSS errors"
            accent="#00ff88"
            glow="rgba(0,255,136,0.18)"
          />
        </div>

        <FlowMerge />

        <div className="gnwi-diagram-col gnwi-diagram-col--center">
          <NodeCard
            icon="🧠"
            title="GNSS Weather AI Engine"
            subtitle="Fusion · prediction · risk scoring"
            accent="#a855f7"
            glow="rgba(168,85,247,0.28)"
            size="lg"
          />
          <FlowArrow />
          <NodeCard
            icon="📊"
            title="National Positioning Forecast"
            subtitle="RTK · accuracy · industry alerts"
            accent="#38bdf8"
            glow="rgba(56,189,248,0.22)"
            size="lg"
          />
        </div>
      </div>
    </div>
  );
}

const INDUSTRY_CHIPS = [
  { label: "Survey", icon: "📐" },
  { label: "Drone", icon: "🚁" },
  { label: "Farming", icon: "🌱" },
  { label: "Transport", icon: "🚗" },
  { label: "Mining", icon: "⛏️" },
];

/** Visual national platform stack (replaces ASCII diagram 2). */
export function NationalPlatformDiagram({ modules }: { modules: string[] }) {
  return (
    <div className="gnwi-diagram gnwi-diagram--platform" aria-label="National positioning intelligence platform stack">
      <div className="gnwi-diagram-header">Full platform stack</div>
      <div className="gnwi-diagram-body">
        <div className="gnwi-diagram-col gnwi-diagram-col--center">
          <NodeCard
            icon="🛰️"
            title="GNSS Satellites"
            subtitle="GPS · GLONASS · Galileo · BeiDou"
            accent="#94a3b8"
          />
          <FlowArrow />
          <NodeCard
            icon="📡"
            title="Zimbabwe CORS Network"
            subtitle="24 reference stations · NTRIP · RINEX"
            accent="#00ff88"
            glow="rgba(0,255,136,0.15)"
          />
          <FlowArrow />
        </div>

        <div className="gnwi-hub">
          <div className="gnwi-hub-ring" aria-hidden />
          <div className="gnwi-hub-inner">
            <div className="gnwi-hub-kicker">Core intelligence layer</div>
            <div className="gnwi-hub-title">National Positioning Intelligence</div>
            <div className="gnwi-hub-modules">
              {modules.map((mod) => (
                <span key={mod} className="gnwi-hub-module-pill">
                  <span className="gnwi-hub-module-check" aria-hidden>
                    ✓
                  </span>
                  {mod}
                </span>
              ))}
            </div>
          </div>
        </div>

        <FlowArrow />

        <div className="gnwi-industry-row">
          {INDUSTRY_CHIPS.map(({ label, icon }) => (
            <div key={label} className="gnwi-industry-chip">
              <span aria-hidden>{icon}</span>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
