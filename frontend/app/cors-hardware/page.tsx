import Image from "next/image";

const EQUIPMENT = [
  {
    kind: "receiver",
    name: "Leica GR50",
    subtitle: "GNSS Reference Server",
    image: "/hardware/gr50.png",
    imageAlt: "Leica GR50 high-precision GNSS reference server — front panel",
    accent: "#168bd2",
    description:
      "From the Leica Geosystems Technical Offer for ZIGSA: the GR50 is a GNSS Reference Server — more than a reference station. Dual power (including PoE), redundant communications, IP67 ports, and tracking for all current and planned GNSS signals.",
    specs: [
      ["Role", "GNSS Reference Server / data centre"],
      ["Constellations", "GPS · GLONASS · Galileo · BeiDou · QZSS · NavIC · SBAS"],
      ["Channels", "555 universal (SmartTrack+)"],
      ["Power", "Dual external + battery + PoE · ~3.1 W typ."],
      ["Comms", "Ethernet · USB · Bluetooth · slot-in radio"],
      ["Environment", "IP67 incl. ports · −40 °C to +65 °C"],
      ["Security", "Firewall · closed ports · user management"],
      ["Monitoring", "SNMP · Active Assist · support tool"],
    ],
  },
  {
    kind: "antenna",
    name: "Leica AR20",
    subtitle: "3D Choke Ring Antenna",
    image: "/hardware/ar20.png",
    imageAlt: "Leica AR20 3D choke ring GNSS antenna",
    accent: "#ff8c00",
    description:
      "Ultimate CORS antenna in the ZIGSA offer: unique 3D choke-ring design optimised for the full L-band (not 1990s flat Type-T rings). Superior multipath rejection and low-elevation tracking for reference-station accuracy.",
    specs: [
      ["Design", "New internal 3D choke-ring"],
      ["Signals", "GPS · GLONASS · Galileo · BeiDou · SBAS · OmniStar"],
      ["Phase centre", "Better than 1 mm"],
      ["Calibration", "NGS / IGS relative or absolute files"],
      ["Supply", "3.3–12 V DC from receiver"],
      ["Impedance", "29 Ω"],
      ["Cable run", "Up to 70 m without in-line amp"],
      ["Protection", "IP67 · −55 °C to +85 °C · 100% humidity"],
    ],
  },
  {
    kind: "radome",
    name: "Leica AR20 Radome",
    subtitle: "Snow / bird / fragment cover",
    image: "/hardware/ar20_radome.png",
    imageAlt: "Leica AR20 antenna with protective radome",
    accent: "#00ff88",
    description:
      "Protective radome supplied with the AR20 in the ZIGSA offer — shields against snow, fragments and bird nesting while preserving geodetic performance. Integrated 3-stage surge protection (IEC 61000-4-5 class 4).",
    specs: [
      ["Purpose", "Snow · fragments · bird nesting"],
      ["Surge", "3-stage protector · ≥ 4 kV waveform"],
      ["North mark", "North indicator on antenna"],
      ["Low elev.", "Improved 0–5° vs standard 2D rings"],
      ["Multipath", "Unsurpassed 3D choke-ring rejection"],
      ["Site note", "Building-entry lightning arrestors protect the GR50"],
      ["Connector", "TNC · receiver-powered"],
      ["Offer source", "Leica ZIGSA Technical Offer §2.2"],
    ],
  },
];

const ARCHITECTURE = [
  {
    step: "1",
    kind: "choke",
    image: "/hardware/ar20.png",
    imageAlt: "Leica AR20 choke ring antenna",
    title: "AR20 Antenna",
    subtitle: "GNSS signals · full L-band",
    note: "Leica AR20 3D choke ring (+ radome)",
    accent: "#ff8c00",
    link: "Coaxial cable · up to 70 m",
  },
  {
    step: "2",
    kind: "receiver",
    image: "/hardware/gr50.png",
    imageAlt: "Leica GR50 receiver",
    title: "Leica GR50 Receiver",
    subtitle: "Tracks GPS · GLONASS · Galileo · BeiDou",
    note: "GNSS Reference Server · 555 channels",
    accent: "#168bd2",
    link: "Ethernet / LTE · RINEX · NTRIP",
  },
  {
    step: "3",
    kind: "server",
    title: "ZINGSA CORS Server",
    subtitle: "NTRIP caster · port 2101",
    note: "RINEX / CMN archive · real-time corrections",
    accent: "#a78bfa",
    link: "ZINGSA API · ionosphere · space weather",
  },
  {
    step: "4",
    kind: "platform",
    title: "Space Weather Platform",
    subtitle: "TEC · monitoring · alerts",
    note: "Ionosphere analytics, space weather and CORS health",
    accent: "#ff4fb3",
  },
];

const REQUIREMENTS = [
  { title: "Power", lines: ["220 V AC with UPS backup", "PoE option for GR50 (802.3af)"], accent: "#168bd2" },
  { title: "Connectivity", lines: ["Ethernet / fibre to CORS server", "4G/LTE fallback modem"], accent: "#00ff88" },
  { title: "Mounting", lines: ["Reinforced concrete pillar", "Forced-centring tribrach · north mark"], accent: "#ff8c00" },
  { title: "Data Output", lines: ["RINEX 2/3 · CMN", "RTCM 3.x via NTRIP / Spider"], accent: "#a78bfa" },
];

const CAPABILITIES = [
  { icon: "GNSS", value: "6+", label: "Constellations tracked", accent: "#168bd2" },
  { icon: "CH", value: "555", label: "Tracking channels", accent: "#00ff88" },
  { icon: "mm", value: "<1 mm", label: "AR20 phase-centre acc.", accent: "#ff8c00" },
  { icon: "m", value: "70 m", label: "Antenna cable without amp", accent: "#a78bfa" },
  { icon: "IP", value: "IP67", label: "Weather protection", accent: "#ff4fb3" },
];

function HardwareVisual({ kind }: { kind: string }) {
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

  return (
    <svg viewBox="0 0 240 90" role="img" aria-label="Monitoring platform illustration">
      <rect x="82" y="18" width="76" height="44" rx="4" fill="#0a1929" stroke="#168bd2" strokeWidth="2" />
      <polyline points="94,48 108,38 122,44 137,30 148,36" fill="none" stroke="#00ff88" strokeWidth="3" />
      <rect x="105" y="66" width="30" height="5" rx="2" fill="#93a4b3" />
      <rect x="96" y="72" width="48" height="5" rx="2" fill="#93a4b3" />
    </svg>
  );
}

function EquipmentCard({ item }: { item: (typeof EQUIPMENT)[number] }) {
  return (
    <article className="hardware-equipment-card" style={{ borderTopColor: item.accent }}>
      <div className="hardware-image-well hardware-image-well--photo">
        <Image
          src={item.image}
          alt={item.imageAlt}
          width={640}
          height={360}
          className="hardware-product-photo"
          sizes="(max-width: 900px) 100vw, 33vw"
        />
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
            Equipment photos and specifications are taken from the{" "}
            <strong>Leica Geosystems Technical Offer for ZIGSA</strong> (24-Sep-21) — GR50 GNSS
            Reference Server and AR20 3D choke-ring antenna deployed across the Zimbabwe CORS
            network.
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
                  <div className={`hardware-flow-visual${item.image ? " hardware-image-well--photo" : ""}`}>
                    {item.image ? (
                      <Image
                        src={item.image}
                        alt={item.imageAlt ?? item.title}
                        width={480}
                        height={240}
                        className="hardware-product-photo hardware-product-photo--flow"
                        sizes="180px"
                      />
                    ) : (
                      <HardwareVisual kind={item.kind} />
                    )}
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
          <p className="hardware-caption">
            Imagery source: Leica Geosystems Technical Offer for ZIGSA — GR50 · AR20 · AR20 radome
          </p>
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
