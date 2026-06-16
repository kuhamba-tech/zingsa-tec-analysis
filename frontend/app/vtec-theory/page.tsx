export default function VtecTheoryPage() {
  const STAGES = [
    { n: "1", title: "Load RINEX / CMN",     formula: null,                                                            desc: "Read observation (.rnx) and navigation (.nav) files. Extract L1, L2 pseudorange and carrier-phase per epoch per PRN." },
    { n: "2", title: "Cycle Slip Detection",  formula: "ΔΦ = Φ₁ − Φ₂ (epoch-to-epoch)",                               desc: "Detect abrupt phase jumps > 0.5 TECU. Correct or discard affected epochs to maintain phase continuity." },
    { n: "3", title: "DCB Correction",        formula: "TECU_corr = TECU_obs − DCB_sat − DCB_rcv",                    desc: "Apply CODE/IGS daily P1-P2 differential code biases. 1 ns DCB ≈ 2.854 TECU at GPS frequencies." },
    { n: "4", title: "Receiver Bias Removal", formula: "VTEC_unbiased = VTEC − bias_rcv",                             desc: "Estimate receiver P1-P2 bias from scatter in code-derived TEC. Typically ±5 TECU per receiver." },
    { n: "5", title: "STEC from Phase",       formula: "STEC = (f₁²·f₂²) / (40.3·(f₁²−f₂²)) · (λ₁Φ₁ − λ₂Φ₂)",   desc: "Convert carrier-phase difference to slant TEC along line-of-sight to each satellite. (Gopi Eq. 4.12)" },
    { n: "6", title: "VTEC via Mapping",      formula: "VTEC = STEC · √(1 − (Rₑ cos E / (Rₑ+H))²)",                 desc: "Apply single-layer mapping function at IPP height H = 350 km, elevation E. (Gopi Eq. 4.17)" },
    { n: "7", title: "TEC Maps & Storage",    formula: null,                                                            desc: "Interpolate VTEC from 24 CORS stations onto regular lat/lon grid over Zimbabwe. Store in TimescaleDB." },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>
      <div>
        <h1 className="page-title">📚 VTEC Theory & Equations</h1>
        <p className="page-subtitle">Step-by-step pipeline from RINEX observation to vertical TEC — following Singh & Tiwari (2022) Chapter 4</p>
      </div>

      {/* IPP geometry diagram */}
      <div className="card card-accent">
        <div className="metric-label" style={{ marginBottom: "0.8rem" }}>Ionospheric Pierce Point (IPP) Geometry</div>
        <svg viewBox="0 0 500 220" style={{ width: "100%", maxWidth: "560px", display: "block" }}>
          {/* Earth */}
          <ellipse cx="250" cy="260" rx="280" ry="120" fill="#0a1a2a" stroke="#244d73" strokeWidth="1.5" />
          <text x="250" y="200" textAnchor="middle" fill="#ffffff" fontSize="12">Earth (Rₑ = 6371 km)</text>
          {/* Ionospheric shell */}
          <ellipse cx="250" cy="80" rx="270" ry="40" fill="none" stroke="#168bd2" strokeWidth="1" strokeDasharray="6 3" opacity="0.6" />
          <text x="490" y="84" textAnchor="end" fill="#168bd2" fontSize="11">Shell H = 350 km</text>
          {/* Satellite */}
          <circle cx="420" cy="20" r="8" fill="#ff8c00" />
          <text x="432" y="25" fill="#ff8c00" fontSize="12">Satellite</text>
          {/* Receiver */}
          <circle cx="90" cy="178" r="6" fill="#00ff88" />
          <text x="60" y="195" fill="#00ff88" fontSize="11">Receiver</text>
          {/* LOS */}
          <line x1="90" y1="178" x2="420" y2="20" stroke="#ffffff" strokeWidth="1.5" />
          {/* IPP */}
          <circle cx="260" cy="78" r="5" fill="#ff4444" />
          <text x="268" y="74" fill="#ff4444" fontSize="11">IPP</text>
          {/* Elevation arc */}
          <text x="108" y="168" fill="#a78bfa" fontSize="11">E°</text>
          {/* Zenith line */}
          <line x1="90" y1="178" x2="90" y2="80" stroke="#444" strokeWidth="1" strokeDasharray="3 3" />
          {/* Labels */}
          <text x="175" y="130" fill="#ffffff" fontSize="11" transform="rotate(-28 175 130)">STEC (slant path)</text>
          <line x1="90" y1="178" x2="260" y2="78" stroke="none" />
          <line x1="260" y1="78" x2="260" y2="178" stroke="#168bd2" strokeWidth="1.5" strokeDasharray="4 2" />
          <text x="270" y="132" fill="#168bd2" fontSize="11">VTEC</text>
        </svg>
      </div>

      {/* Pipeline stages */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
        {STAGES.map((s) => (
          <div key={s.n} className="card" style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
            <div style={{ width: "2rem", height: "2rem", background: "var(--accent)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, flexShrink: 0, color: "#000" }}>
              {s.n}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>{s.title}</div>
              {s.formula && (
                <div style={{ fontFamily: "monospace", fontSize: "0.82rem", color: "var(--accent)", background: "#0d1b2a", padding: "0.3rem 0.6rem", borderRadius: "5px", marginBottom: "0.35rem", overflowX: "auto" }}>
                  {s.formula}
                </div>
              )}
              <div style={{ fontSize: "0.83rem", color: "var(--text-muted)", lineHeight: 1.55 }}>{s.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="banner banner-info" style={{ fontSize: "0.8rem" }}>
        Reference: Singh, A.K. &amp; Tiwari, S. (2022). <em>GNSS-Based TEC Analysis</em>, Chapter 4: Ionospheric TEC Estimation. All equations implemented in <code>tec_core.py</code>.
      </div>
    </div>
  );
}
