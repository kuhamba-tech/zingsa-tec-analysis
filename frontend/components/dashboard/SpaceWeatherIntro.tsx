import Link from "next/link";
import styles from "./SpaceWeatherIntro.module.css";

const impacts = [
  { icon: "🛰️", title: "GNSS Positioning", detail: "Reduced GPS/GNSS accuracy, loss of signal tracking and interruptions to high-precision surveying and navigation." },
  { icon: "📡", title: "Communications", detail: "Disruptions to HF radio, satellite communications and services dependent on reliable satellite positioning." },
  { icon: "⚡", title: "Electricity Networks", detail: "Geomagnetically induced currents (GICs) may cause transformer saturation, abnormal heating, increased reactive power demand and voltage instability." },
  { icon: "🔬", title: "Scientific Research", detail: "Monitoring changes in Zimbabwe's ionosphere and geomagnetic environment to improve understanding, forecasting and early-warning capabilities." },
];

const arrivals = [
  { icon: "☀️", title: "Solar Flare Radiation", timing: "About 8 Minutes", text: "X-rays and extreme ultraviolet radiation travel at the speed of light, reaching Earth in approximately eight minutes. Strong flares can disturb the ionosphere, disrupt high-frequency (HF) radio communications and affect satellite navigation signals." },
  { icon: "⚡", title: "Solar Energetic Particles", timing: "Minutes to Hours", text: "High-energy particles accelerated during solar eruptions can reach near-Earth space within minutes to hours, increasing radiation exposure risks for satellites, astronauts and high-altitude aviation, particularly on polar routes." },
  { icon: "🌍", title: "Coronal Mass Ejections (CMEs)", timing: "Typically 1–3 Days", text: "Massive clouds of magnetised plasma can travel towards Earth and trigger geomagnetic storms when their magnetic fields interact strongly with Earth's magnetosphere. Depending on their intensity, these storms can induce electrical currents in power transmission networks, potentially causing transformer overheating, voltage instability, equipment damage and, in extreme cases, power outages." },
];

export default function SpaceWeatherIntro() {
  return (
    <section className={styles.panel} aria-labelledby="space-weather-intro-title">
      <div className={styles.copy}>
        <div className={styles.heading}>
          <div><h2 id="space-weather-intro-title">What is <span>Space Weather?</span></h2></div>
        </div>
        <p>
          Space weather refers to changing conditions on the Sun, in the solar wind,
          and within Earth’s magnetosphere and ionosphere. Solar flares, coronal mass
          ejections and variations in the solar wind can disturb Earth’s near-space
          environment, potentially affecting satellite navigation, radio communications,
          satellite operations and electricity transmission networks.
        </p>
        <h3 className={styles.arrivalsHeading}><span aria-hidden="true">◷</span> How solar activity reaches Earth</h3>
        <ol className={styles.arrivals}>
          {arrivals.map(({ title, timing, text }, index) => (
            <li key={title} className={styles[`arrival${index}`]}>
              <ScienceArtwork kind={index === 0 ? "flare" : index === 1 ? "particles" : "cme"} />
              <div className={styles.arrivalCopy}><strong>{title}</strong><p>{text}</p></div>
              <span className={styles.timing}><span aria-hidden="true">{index === 2 ? "▦" : "◷"}</span>{timing}</span>
            </li>
          ))}
        </ol>
      </div>

      <figure className={styles.visual}>
        <a className={styles.imageLink} href="/images/space-weather-sun-earth.webp" target="_blank" rel="noopener noreferrer" aria-label="Open the Sun-to-Earth illustration at full size in a new tab">
        <img
          src="/images/space-weather-sun-earth.webp"
          alt="Sun-to-Earth illustration identifying solar-flare radiation, solar wind, Earth's magnetosphere and the ionosphere. Sizes and distances are not to scale."
          width={1440}
          height={901}
          loading="lazy"
          decoding="async"
          className={styles.illustration}
        />
        </a>
      </figure>
      <div className={styles.impactsSection}>
        <h3 className={styles.impactsHeading}>Why It Matters for Zimbabwe</h3>
        <ul className={styles.impacts}>
          {impacts.map(({ title, detail }, index) => (
            <li key={title}>
              <ScienceArtwork kind={["satellite", "radio", "grid", "research"][index]} />
              <div><strong>{title}</strong><p>{detail}</p></div>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.mission}><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4L40 11V25Q38 36 24 44Q10 36 8 25V11Z M16 24L22 30L33 18" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round"/></svg><p><strong>ZINGSA monitors solar activity, geomagnetic conditions and Zimbabwe&apos;s ionosphere to support scientific research, reliable navigation and the protection of critical national infrastructure.</strong></p></div>
      <div className={styles.footer}><p><em>From Solar Activity to National Infrastructure Protection.</em></p><Link href="/understanding-tec/" className={styles.link}>Explore the science <span aria-hidden="true">↗</span></Link></div>
    </section>
  );
}

function ScienceArtwork({ kind }: { kind: string }) {
  if (kind === "flare" || kind === "cme") {
    return <div aria-hidden="true" className={`${styles.artwork} ${styles.solarArt} ${kind === "cme" ? styles.cmeArt : ""}`}><span /></div>;
  }
  return (
    <svg className={styles.artwork} viewBox="0 0 140 150" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`science-bg-${kind}`} x2="0.7" y2="1"><stop stopColor={kind === "grid" ? "#354065" : "#103967"}/><stop offset=".65" stopColor={kind === "grid" ? "#d38b57" : "#082442"}/><stop offset="1" stopColor={kind === "grid" ? "#f9c36b" : "#020c1a"}/></linearGradient>
        <linearGradient id={`science-metal-${kind}`}><stop stopColor="#b6dfff"/><stop offset=".5" stopColor="#4b81b4"/><stop offset="1" stopColor="#c4edff"/></linearGradient>
      </defs>
      <rect width="140" height="150" rx="10" fill={`url(#science-bg-${kind})`}/>
      <ellipse cx="70" cy="136" rx="48" ry="5" fill="#00bbff" opacity=".16"/>
      {kind === "particles" && <g strokeLinecap="round">{Array.from({ length: 14 }, (_, i) => <path key={i} d={`M12 ${132-i%3*4} Q${45+i*2} ${90-i*2} ${70+i*5} ${12+i%4*6}`} stroke={i%3 === 0 ? "#c494ff" : "#35cfff"} strokeWidth={i%3 === 0 ? 2.5 : 1} opacity={0.45+i%4*.15}/>)}<circle cx="17" cy="126" r="9" fill="#b6f6ff"/></g>}
      {kind === "satellite" && <g transform="rotate(-33 70 72)" stroke="#94ceff" strokeWidth="1.2"><path d="M57 58H16V88H57 M83 58H124V88H83" fill="#15568e"/><path d="M29 58V88 M43 58V88 M97 58V88 M110 58V88 M16 73H124"/><rect x="56" y="56" width="28" height="36" rx="5" fill={`url(#science-metal-${kind})`}/><path d="M61 52L70 34L79 52 M70 34V21 M70 92V110" fill="none"/><path d="M54 105Q70 126 86 105" fill="#a9e4ff"/></g>}
      {kind === "radio" && <g fill="none" strokeLinecap="round"><path d="M70 36L44 134H96Z M53 102H87 M59 79H81 M52 105L86 127 M88 105L54 127 M60 81L82 102 M80 81L58 102" stroke="#99bce0" strokeWidth="2"/><circle cx="70" cy="35" r="4" fill="#64e8ff"/><path d="M55 23Q38 36 55 49 M85 23Q102 36 85 49 M46 14Q17 36 46 58 M94 14Q123 36 94 58 M37 5Q-2 36 37 67 M103 5Q142 36 103 67" stroke="#3bc7ff" strokeWidth="2"/></g>}
      {kind === "grid" && <g fill="none" stroke="#9cc5e3" strokeWidth="1.8"><path d="M70 15L46 135 M70 15L94 135 M38 53H102 M31 79H109 M56 38H84 M40 53L70 34L100 53 M49 113H91 M49 113L88 80L58 54 M91 113L52 80L82 54 M47 133L90 113 M93 133L50 113 M26 79L18 103 M114 79L122 103 M33 54L25 68 M107 54L115 68"/><path d="M0 60Q17 65 31 54 M109 54Q123 65 140 60 M0 94Q17 99 26 79 M114 79Q123 99 140 94" opacity=".7"/></g>}
      {kind === "research" && <g><rect x="11" y="28" width="118" height="87" rx="6" fill="#031221" stroke="#3ccfff"/><rect x="18" y="35" width="104" height="72" fill="#06395a"/><path d="M69 43L83 49L95 48L106 60L100 72L96 89L81 97L69 91L61 95L48 82L36 77L40 63L54 58L57 48Z" fill="#24d48b" stroke="#a8f8be"/><path d="M42 69L59 72L66 60L77 69L90 66L97 75L87 84L72 87L61 80L50 83Z" fill="#c9e344"/><path d="M58 115V126H82V115 M45 128H95" stroke="#5bbbee" strokeWidth="4"/><path d="M21 100H116 M24 96L34 88L40 91L47 83" fill="none" stroke="#14d8ff"/></g>}
    </svg>
  );
}
