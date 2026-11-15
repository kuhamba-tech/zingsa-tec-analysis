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
        <span className={styles.eyebrow}><span aria-hidden="true">✦</span> OUR SUN. OUR CONNECTED WORLD.</span>
        <h2 id="space-weather-intro-title">What is <span>Space Weather?</span></h2>
        <p>
          When the Sun releases powerful bursts of energy and magnetised plasma,
          their effects can reach Earth at different times:
        </p>
        <ol className={styles.arrivals}>
          {arrivals.map(({ icon, title, timing, text }) => (
            <li key={title}>
              <div className={styles.arrivalTitle}><span aria-hidden="true">{icon}</span><strong>{title}</strong><span className={styles.timing}>{timing}</span></div>
              <p>{text}</p>
            </li>
          ))}
        </ol>
        <h3 className={styles.impactsHeading}>Why it matters for Zimbabwe</h3>
        <ul className={styles.impacts}>
          {impacts.map(({ icon, title, detail }) => (
            <li key={title}>
              <span className={styles.icon} aria-hidden="true">{icon}</span>
              <div><strong>{title}</strong><span>{detail}</span></div>
            </li>
          ))}
        </ul>
        <p className={styles.mission}><strong>ZINGSA monitors solar activity, geomagnetic conditions and Zimbabwe&apos;s ionosphere to support scientific research, reliable navigation and the protection of critical national infrastructure.</strong></p>
        <p className={styles.tagline}><em>From Solar Activity to National Infrastructure Protection.</em></p>
        <Link href="/understanding-tec/" className={styles.link}>Explore the science <span aria-hidden="true">↗</span></Link>
      </div>

      <figure className={styles.visual}>
        <img
          src="/images/solar-proton-event.jpg"
          alt="Illustration of the Sun releasing solar plasma towards Earth, with magnetic field lines showing the solar wind interacting with Earth's purple magnetosphere. Sizes and distances are not to scale."
          width={1920}
          height={960}
          loading="lazy"
          decoding="async"
          className={styles.illustration}
        />
        <figcaption>FROM THE SUN TO EARTH <span>Illustration · not to scale</span></figcaption>
        <a className={styles.credit} href="https://www.sci.news/space/solar-proton-events-06983.html" target="_blank" rel="noopener noreferrer">Image credit: NASA · via Sci.News</a>
      </figure>
    </section>
  );
}
