import styles from "./DataSources.module.css";

/**
 * Only sources the site actually fetches or displays.
 * Image-1 candidates STEREO / LASCO / SOHO / LMSAL / GONG / Space Weather Canada
 * are omitted — they are not used in live clients.
 */
type Source = {
  name: string;
  href: string;
  use: string;
};

const SOURCES: Source[] = [
  {
    name: "NOAA Space Weather Prediction Center (SWPC)",
    href: "https://www.swpc.noaa.gov/",
    use: "Live Kp, Dst, F10.7, GOES X-rays and protons, solar wind, alerts and forecasts.",
  },
  {
    name: "Solar Dynamics Observatory (SDO)",
    href: "https://sdo.gsfc.nasa.gov/",
    use: "Solar disk imagery used on solar briefing and solar-disk panels.",
  },
  {
    name: "Atmospheric Imaging Assembly (AIA)",
    href: "https://sdo.gsfc.nasa.gov/data/",
    use: "SDO/AIA coronal images (including 193 Å) shown with the solar products.",
  },
  {
    name: "ZINGSA CORS / Leica Spider",
    href: "https://zingsaservices.ac.zw/sbc",
    use: "Spider Site Status and live Zimbabwe CORS NTRIP observations for local VTEC.",
  },
  {
    name: "NASA DONKI",
    href: "https://ccmc.gsfc.nasa.gov/tools/DONKI/",
    use: "Solar flare, CME and geomagnetic storm event catalogues.",
  },
  {
    name: "DLR Ionosphere Monitoring and Prediction Center",
    href: "https://impc.dlr.de/",
    use: "Global TEC forecast maps compared with Zimbabwe measurements.",
  },
  {
    name: "World Data Center for Geomagnetism, Kyoto",
    href: "https://wdc.kugi.kyoto-u.ac.jp/",
    use: "Dst and ASY/SYM geomagnetic indices.",
  },
  {
    name: "GFZ Potsdam",
    href: "https://kp.gfz.de/",
    use: "Historical and nowcast Kp, ap, Ap and related solar-activity series.",
  },
  {
    name: "NASA OMNIWeb",
    href: "https://omniweb.gsfc.nasa.gov/",
    use: "Historical solar-wind and geomagnetic indices for TEC comparisons.",
  },
  {
    name: "CelesTrak Space Weather",
    href: "https://celestrak.org/SpaceData/",
    use: "Historical space-weather indices for time-series analysis.",
  },
  {
    name: "INTERMAGNET / British Geological Survey",
    href: "https://imag-data.bgs.ac.uk/GIN_V1/GINForms2",
    use: "Ground magnetometer minutes for geomagnetic analysis.",
  },
  {
    name: "UCAR COSMIC-2",
    href: "https://data.cosmic.ucar.edu/gnss-ro/cosmic2/provisional/spaceWeather/",
    use: "Radio-occultation space-weather archive products.",
  },
  {
    name: "LASP LISIRD",
    href: "https://lasp.colorado.edu/lisird/",
    use: "Extended F10.7 solar radio flux history for solar-cycle charts.",
  },
  {
    name: "GIRO / DIDBase",
    href: "https://giro.uml.edu/didbase/",
    use: "Ionosonde station metadata linked from regional TEC validation.",
  },
  {
    name: "TriGNet",
    href: "http://trignet.co.za/",
    use: "South African CORS catalogue and RINEX for the regional network layer.",
  },
  {
    name: "IGS / BKG broadcast ephemeris",
    href: "https://igs.bkg.bund.de/",
    use: "GPS broadcast ephemeris for live NTRIP elevation and VTEC geometry.",
  },
  {
    name: "CODE / AIUB",
    href: "https://www.aiub.unibe.ch/research/code___analysis_center/index_eng.html",
    use: "Satellite differential code bias files for TEC processing.",
  },
  {
    name: "SolarHam",
    href: "https://solarham.com/",
    use: "Daily solar briefing imagery with SDO fallback.",
  },
  {
    name: "Esri ArcGIS",
    href: "https://www.arcgis.com/",
    use: "Satellite, street and label basemap tiles on the CORS maps.",
  },
];

export default function DataSources() {
  return (
    <section className={styles.section} aria-labelledby="data-sources-title">
      <h2 id="data-sources-title" className={styles.title}>
        Data Sources
      </h2>
      <p className={styles.intro}>
        This website relays data and imagery from the following sources.
      </p>
      <ul className={styles.list}>
        {SOURCES.map((source) => (
          <li key={source.name}>
            <a href={source.href} target="_blank" rel="noopener noreferrer">
              {source.name}
              <span className={styles.external} aria-hidden>
                {" "}
                ↗
              </span>
            </a>
            <span className={styles.use}>{source.use}</span>
          </li>
        ))}
      </ul>
      <p className={styles.note}>
        Local VTEC maps and navigation advisories are calculated by this platform from Zimbabwe CORS
        observations. Each listed provider remains responsible for its original products.
      </p>
    </section>
  );
}
