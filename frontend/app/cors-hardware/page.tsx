const EQUIPMENT = [
  {
    kind: "receiver",
    name: "Leica GR50",
    subtitle: "GNSS Receiver",
    accent: "#168bd2",
    description:
      "Professional reference station receiver with SmartTrack+ technology. Supports current and planned GNSS constellations with up to 555 channels for uninterrupted continuous operation.",
    specs: [
      ["Constellations", "GPS - GLONASS - Galileo - BeiDou"],
      ["Channels", "555 universal"],
      ["Frequencies", "L1 - L2 - L5 / E1 - E5a - E5b"],
      ["Position acc.", "H: 3 mm + 0.1 ppm / V: 3.5 mm"],
      ["Data rate", "Up to 100 Hz"],
      ["Storage", "8 GB internal flash"],
      ["Power", "9-36 V DC - PoE"],
      ["Connectivity", "Ethernet - RS232 - USB"],
    ],
  },
  {
    kind: "antenna",
    name: "Leica AR10",
    subtitle: "Geodetic Antenna",
    accent: "#00ff88",
    description:
      "High-performance geodetic choke-ring-free antenna. Hemispherical radome protects the element while maintaining phase-centre stability across all tracked frequencies.",
    specs: [
      ["Type", "Geodetic, multi-frequency"],
      ["Constellations", "GPS - GLONASS - Galileo - BeiDou"],
      ["Frequencies", "L1 - L2 - L5"],
      ["Phase centre", "< 1 mm repeatability"],
      ["Gain", "> 0 dBic at 10 deg elevation"],
      ["Axial ratio", "< 3 dB zenith"],
      ["Cable", "TNC female connector"],
      ["Protection", "IP67 rated"],
    ],
  },
  {
    kind: "choke",
    name: "Leica AR20",
    subtitle: "Choke Ring Antenna",
    accent: "#ff8c00",
    description:
      "Geodetic choke ring antenna providing superior multipath rejection. The countering ground plane suppresses low-elevation multipath signals for reference station accuracy.",
    specs: [
      ["Type", "Choke ring, geodetic"],
      ["Constellations", "GPS - GLONASS - Galileo"],
      ["Frequencies", "L1 - L2 - L5"],
      ["Multipath rej.", "< -40 dB ground plane"],
      ["Phase centre", "< 0.5 mm stability"],
      ["Elevation mask", "0-90 deg"],
      ["Cable", "TNC female connector"],
      ["Protection", "IP67 rated"],
    ],
  },
];

const ARCHITECTURE = [
  {
    step: "1",
    kind: "choke",
    title: "AR20 / AR10 Antenna",
    subtitle: "GNSS signals - L1 / L2 / L5",
    note: "Leica AR20 choke ring - Leica AR10 geodetic radome",
    accent: "#ff8c00",
    link: "Coaxial cable - low-loss RF",
  },
  {
    step: "2",
    kind: "receiver",
    title: "Leica GR50 Receiver",
    subtitle: "Tracks GPS - GLONASS - Galileo - BeiDou",
    note: "555-channel reference station receiver",
    accent: "#168bd2",
    link: "Ethernet / LTE - RINEX - CMN - NTRIP",
  },
  {
    step: "3",
    kind: "server",
    title: "ZINGSA CORS Server",
    subtitle: "NTRIP caster - port 2101",
    note: "RINEX / CMN archive - real-time corrections",
    accent: "#a78bfa",
    link: "ZINGSA API - ionosphere - space weather",
  },
  {
    step: "4",
    kind: "platform",
    title: "Space Weather Platform",
    subtitle: "TEC - monitoring - alerts",
    note: "Ionosphere analytics, space weather and CORS health",
    accent: "#ff4fb3",
  },
];

const REQUIREMENTS = [
  { title: "Power", lines: ["220 V AC with UPS backup", "PoE option for GR50 (802.3af)"], accent: "#168bd2" },
  { title: "Connectivity", lines: ["Ethernet / fibre to CORS server", "4G/LTE fallback modem"], accent: "#00ff88" },
  { title: "Mounting", lines: ["Reinforced concrete pillar", "Forced-centring tribrach"], accent: "#ff8c00" },
  { title: "Data Output", lines: ["RINEX 2/3 - CMN", "RTCM 3.x via NTRIP"], accent: "#a78bfa" },
];

const CAPABILITIES = [
  { icon: "GNSS", value: "4", label: "GNSS constellations", accent: "#168bd2" },
  { icon: "CH", value: "555", label: "Tracking channels", accent: "#00ff88" },
  { icon: "Hz", value: "100 Hz", label: "Max data rate", accent: "#ff8c00" },
  { icon: "mm", value: "3 mm", label: "Position accuracy", accent: "#a78bfa" },
  { icon: "IP", value: "IP67", label: "Weather protection", accent: "#ff4fb3" },
];

function HardwareVisual({ kind }: { kind: string }) {
  if (kind === "receiver") {
    return (
      <svg viewBox="0 0 240 90" role="img" aria-label="GNSS receiver illustration">
        <rect x="42" y="24" width="150" height="44" rx="5" fill="#dce4ea" stroke="#8aa0ad" strokeWidth="2" />
        <rect x="55" y="33" width="58" height="25" rx="2" fill="#edf4f7" stroke="#7d929e" />
        <circle cx="133" cy="45" r="8" fill="#f0b429" stroke="#9a6b0b" />
        <circle cx="157" cy="45" r="8" fill="#d1d5db" stroke="#7d8791" />
        <rect x="176" y="34" width="8" height="22" fill="#9aa8b2" />
        <path d="M192 30 l22 9 v18 l-22 9 z" fill="#c8d4dc" stroke="#8aa0ad" />
      </svg>
    );
  }

  if (kind === "server") {
    return (
      <svg viewBox="0 0 240 90" role="img" aria-label="Server illustration">
        <rect x="92" y="14" width="56" height="62" rx="4" fill="#101827" stroke="#168bd2" strokeWidth="2" />
        {[26, 40, 54].map((y, i) => (
          <g key={y}>
            <rect x="102" y={y} width="36" height="8" rx="2" fill="#0a0f1a" stroke="#406286" />
            <circle cx="108" cy={y + 4} r="2" fill={i === 1 ? "#ff8c00" : "#00ff88"} />
          </g>
        ))}
      </svg>
    );
  }

  if (kind === "platform") {
    return (
      <svg viewBox="0 0 240 90" role="img" aria-label="Monitoring platform illustration">
        <rect x="82" y="18" width="76" height="44" rx="4" fill="#0a1929" stroke="#168bd2" strokeWidth="2" />
        <polyline points="94,48 108,38 122,44 137,30 148,36" fill="none" stroke="#00ff88" strokeWidth="3" />
        <rect x="105" y="66" width="30" height="5" rx="2" fill="#93a4b3" />
        <rect x="96" y="72" width="48" height="5" rx="2" fill="#93a4b3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 240 90" role="img" aria-label="GNSS antenna illustration">
      <ellipse cx="92" cy="60" rx="46" ry="9" fill="#c98628" stroke="#8a5a1d" strokeWidth="2" />
      <rect x="50" y="42" width="84" height="18" rx="4" fill="#f0a43a" stroke="#8a5a1d" />
      <ellipse cx="92" cy="42" rx="42" ry="9" fill="#d7dde4" stroke="#8aa0ad" strokeWidth="2" />
      <path d="M145 62 Q173 16 207 62 Z" fill="#eef2f6" stroke="#b4c1cc" strokeWidth="2" />
      <ellipse cx="176" cy="62" rx="35" ry="7" fill="#d4dbe2" stroke="#b4c1cc" />
    </svg>
  );
}

function EquipmentCard({ item }: { item: (typeof EQUIPMENT)[number] }) {
  return (
    <article className="hardware-equipment-card" style={{ borderTopColor: item.accent }}>
      <div className="hardware-image-well">
        <HardwareVisual kind={item.kind} />
      </div>
      <h3>{item.name}</h3>
      <p className="hardware-card-subtitle">{item.subtitle}</p>
      <p className="hardware-description">{item.description}</p>
      <table className="hardware-spec-table">
        <tbody>
          {item.specs.map(([label, value]) => (
            <tr key={label}>
              <th>{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

export default function CorsHardwarePage() {
  return (
    <div className="hardware-page">
      <section className="hardware-hero">
        <div>
          <p className="hardware-eyebrow">ZINGSA CORS Network</p>
          <h1>Station Hardware Specification</h1>
          <p>
            Each Zimbabwe CORS station is equipped with Leica geodetic-grade GNSS hardware providing centimetre-level positioning and continuous multi-constellation observation for ionospheric research and RTK/PPP correction services.
          </p>
        </div>
      </section>

      <section>
        <p className="hardware-section-label">Station Equipment</p>
        <div className="hardware-equipment-grid">
          {EQUIPMENT.map((item) => (
            <EquipmentCard key={item.name} item={item} />
          ))}
        </div>
      </section>

      <section>
        <p className="hardware-section-label">Typical Station Architecture</p>
        <div className="hardware-architecture-card">
          <p className="hardware-architecture-title">Signal Flow Diagram</p>
          <div className="hardware-flow">
            {ARCHITECTURE.map((item, index) => (
              <div className="hardware-flow-group" key={item.step}>
                <article className="hardware-flow-card" style={{ borderColor: item.accent }}>
                  <span className="hardware-step" style={{ background: item.accent }}>{item.step}</span>
                  <div className="hardware-flow-visual">
                    <HardwareVisual kind={item.kind} />
                  </div>
                  <h3 style={{ color: item.accent }}>{item.title}</h3>
                  <p>{item.subtitle}</p>
                  <small>{item.note}</small>
                </article>
                {index < ARCHITECTURE.length - 1 && (
                  <div className="hardware-link">
                    <span>{"->"}</span>
                    <small>{item.link}</small>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="hardware-caption">Equipment imagery: Leica GR50 - Leica AR10 - Leica AR20 - ZINGSA CORS Network</p>
        </div>
      </section>

      <section className="hardware-requirements">
        <div className="hardware-requirements-title">Station Requirements</div>
        <div className="hardware-requirements-grid">
          {REQUIREMENTS.map((item) => (
            <article key={item.title} style={{ borderLeftColor: item.accent }}>
              <h3>{item.title}</h3>
              {item.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </article>
          ))}
        </div>
      </section>

      <section>
        <p className="hardware-section-label">Network Capability Summary</p>
        <div className="hardware-capability-grid">
          {CAPABILITIES.map((item) => (
            <article key={item.label} className="hardware-capability-card" style={{ borderTopColor: item.accent }}>
              <div className="hardware-capability-icon" style={{ color: item.accent }}>{item.icon}</div>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
