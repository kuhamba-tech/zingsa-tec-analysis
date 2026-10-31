"use client";

import { useEffect, useState } from "react";
import { getSolarBrief, type SolarBriefImage, type SolarBriefResponse, type SolarMonitorRegion } from "@/lib/api";
import type { SolarActivityFull } from "@/lib/types";
import SwSectionBanner from "./SwSectionBanner";
import styles from "./EarthsideSolarNews.module.css";

function kpWords(kp: number): string {
  if (kp < 3) return "Quiet";
  if (kp < 4) return "Unsettled";
  if (kp < 5) return "Active";
  if (kp < 6) return "G1, minor storm";
  if (kp < 7) return "G2, moderate storm";
  if (kp < 8) return "G3, strong storm";
  if (kp < 9) return "G4, severe storm";
  return "G5, extreme storm";
}

function windWords(speed: number): string {
  if (speed < 400) return "Slow";
  if (speed < 550) return "Average";
  return "Fast";
}

function densityWords(density: number): string {
  if (density < 3) return "Low";
  if (density < 10) return "Average";
  return "High";
}

function fieldWords(bt: number): string {
  if (bt < 5) return "Weak";
  if (bt < 10) return "Average";
  return "Strong";
}

function orientation(bz: number): string {
  if (bz <= -0.5) return "South";
  if (bz >= 0.5) return "North";
  return "Mixed";
}

function regionSentence(brief: SolarBriefResponse): string {
  const spotted = brief.spotted_region_count;
  const facing = brief.earth_facing_region_count;
  const plages = brief.plage_count;
  if (spotted == null && facing == null) {
    return "The Earth-facing sunspot count is not available from the latest NOAA region summary.";
  }
  const count = spotted ?? facing ?? 0;
  const noun = count === 1 ? "spotted region" : "spotted regions";
  const verb = count === 1 ? "is" : "are";
  const plageText =
    plages != null && plages > 0
      ? ` ${plages} plage${plages === 1 ? "" : "s"} without spots ${plages === 1 ? "is" : "are"} listed as well.`
      : "";
  const limb =
    spotted != null && facing != null && spotted !== facing
      ? ` ${facing} of the spotted regions have centers on the Earth-facing hemisphere; the rest are at the limb.`
      : "";
  const spots =
    brief.sunspot_number != null
      ? ` The sunspot number from the Earth-facing centers is ${brief.sunspot_number}.`
      : "";
  return `There ${verb} ${count} ${noun} in the latest NOAA summary.${plageText}${limb}${spots}`;
}

function forecastSentence(brief: SolarBriefResponse): string {
  const parts: string[] = [];
  if (brief.earth_directed_cme === false) {
    parts.push("NOAA's coronagraph check shows no Earth-directed coronal mass ejection.");
  } else if (brief.earth_directed_cme === true) {
    parts.push("NOAA reports an Earth-directed coronal mass ejection. It affects Zimbabwe only if it arrives with a southward magnetic field.");
  }
  if (brief.coronal_hole_stream) {
    const polarity = brief.stream_polarity ? `${brief.stream_polarity}-polarity ` : "";
    parts.push(`A ${polarity}coronal-hole high-speed stream is in the NOAA forecast.`);
  }
  if (brief.expected_kp != null) {
    const scale = brief.expected_kp_scale ? `, ${brief.expected_kp_scale}` : "";
    const window = brief.expected_kp_window ? ` for ${brief.expected_kp_window}` : "";
    parts.push(`The greatest expected 3-hour Kp${window} is ${brief.expected_kp}${scale}.`);
  }
  if (brief.storm_window && brief.expected_kp_scale) {
    parts.push(`${brief.expected_kp_scale} is expected ${brief.storm_window}.`);
  }
  parts.push("Over Zimbabwe that arrival is checked on TEC and S4 from the CORS network.");
  return parts.join(" ");
}

function chanceDetail(brief: SolarBriefResponse): string {
  const rows = brief.regions.map((region) => `${region.number} ${region.c_percent}%`).join(", ");
  const listed = rows ? ` NOAA lists C-class chances of ${rows}.` : "";
  return `C-flaring adds those region chances, which is the whole-disk figure SolarHam posts.${listed} M-flaring is NOAA's chance of an M-class or larger flare on the first forecast day, and X-flaring is the chance of an X-class flare.`;
}

export default function EarthsideSolarNews({
  solar,
  kp,
}: {
  solar: SolarActivityFull | null;
  kp: number | null;
}) {
  const [brief, setBrief] = useState<SolarBriefResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getSolarBrief()
        .then((payload) => {
          if (cancelled) return;
          setBrief((current) => {
            if ((current?.monitor_regions?.length ?? 0) > 0 && !(payload.monitor_regions?.length ?? 0)) {
              return current;
            }
            return payload;
          });
          setFailed(false);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };
    load();
    const timer = window.setInterval(load, 5 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const wind = solar?.solar_wind;
  const speed = wind?.speed;
  const density = wind?.density;
  const bt = wind?.bt;
  const bz = wind?.bz;

  return (
    <section className="card" aria-label="Earth-facing solar news">
      <SwSectionBanner
        title="Earth-facing solar news"
        meta={
          <a href="https://solarham.com/" target="_blank" rel="noopener noreferrer">
            SolarHam
          </a>
        }
      />
      <p className={styles.kicker}>
        Sunspot regions and flare chances are the NOAA figures SolarHam posts. The disks and the
        region table refresh about every five minutes from the newest SDO frames and the NOAA summary.
        {brief?.issued ? ` Probability table issued ${brief.issued}.` : ""}
      </p>
      {failed && <p className={styles.kicker}>The solar brief could not be loaded.</p>}
      {!failed && brief == null && <p className={styles.kicker}>Loading the Earth-facing solar brief.</p>}

      <div className={styles.block}>
        <h4>Geomagnetics</h4>
        <div className={styles.facts}>
          <Fact label="Kp" value={kp == null ? "—" : `${kp} · ${kpWords(kp)}`} />
          <Fact
            label="Solar wind speed"
            value={speed == null ? "—" : `${Math.round(speed)} km/s · ${windWords(speed)}`}
          />
          <Fact
            label="Solar wind density"
            value={density == null ? "—" : `${density.toFixed(1)} /cm³ · ${densityWords(density)}`}
          />
          <Fact label="IMF strength" value={bt == null ? "—" : `${bt.toFixed(1)} nT · ${fieldWords(bt)}`} />
          <Fact
            label="IMF orientation"
            value={bz == null ? "—" : `${orientation(bz)} · Bz ${bz.toFixed(1)} nT`}
          />
        </div>
      </div>

      <div className={styles.block}>
        <h4>Solar activity</h4>
        <p>{brief ? regionSentence(brief) : "Waiting for the NOAA region summary."}</p>
      </div>

      <div className={styles.block}>
        <h4>Flaring probabilities</h4>
        <div className={styles.facts}>
          <Fact label="C-flaring" value={brief?.c_percent == null ? "—" : `${brief.c_percent}%`} />
          <Fact label="M-flaring" value={brief?.m_percent == null ? "—" : `${brief.m_percent}%`} />
          <Fact label="X-flaring" value={brief?.x_percent == null ? "—" : `${brief.x_percent}%`} />
        </div>
        <p>{brief && (brief.c_percent != null || brief.m_percent != null) ? chanceDetail(brief) : brief?.error ?? ""}</p>
      </div>

      <div className={styles.block}>
        <h4>Solar flaring</h4>
        <p>
          {brief?.flares_today
            ? `Today so far, UTC: ${brief.flares_today.label}. Yesterday: ${brief.flares_yesterday?.label ?? "—"}. These are GOES X-ray flares of class C or higher.`
            : "The GOES flare list for today and yesterday is not available."}
        </p>
      </div>

      <div className={styles.block}>
        <h4>Forecast</h4>
        <p>{brief ? forecastSentence(brief) : "Waiting for the NOAA forecast."}</p>
      </div>

      {brief && (brief.monitor_images?.length ?? 0) > 0 && (
        <SolarDiskBoard images={brief.monitor_images} regions={brief.monitor_regions} issued={brief.monitor_issued} />
      )}

      {brief && brief.images.length > 0 && (
        <div className={styles.images}>
          {brief.images.map((image) => (
            <BriefImage key={`${image.key}-${image.url}`} image={image} />
          ))}
        </div>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.fact}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const CENTER = 511.5 / 1024;
const RADIUS = 479 / 1024;

function project(latDeg: number, cmdDeg: number): [number, number] | null {
  const lat = (latDeg * Math.PI) / 180;
  const cmd = (cmdDeg * Math.PI) / 180;
  if (Math.cos(lat) * Math.cos(cmd) <= 0) return null;
  const east = Math.cos(lat) * Math.sin(cmd);
  const north = Math.sin(lat);
  return [CENTER + east * RADIUS, CENTER - north * RADIUS];
}

function gridPath(samples: Array<[number, number] | null>): string {
  let path = "";
  let drawing = false;
  for (const point of samples) {
    if (!point) {
      drawing = false;
      continue;
    }
    path += `${drawing ? "L" : "M"}${(point[0] * 100).toFixed(2)} ${(point[1] * 100).toFixed(2)} `;
    drawing = true;
  }
  return path;
}

function diskGrid(): string[] {
  const paths: string[] = [];
  for (const lat of [-60, -30, 0, 30, 60]) {
    const samples: Array<[number, number] | null> = [];
    for (let cmd = -90; cmd <= 90; cmd += 3) samples.push(project(lat, cmd));
    paths.push(gridPath(samples));
  }
  for (const cmd of [-60, -30, 0, 30, 60]) {
    const samples: Array<[number, number] | null> = [];
    for (let lat = -90; lat <= 90; lat += 3) samples.push(project(lat, cmd));
    paths.push(gridPath(samples));
  }
  return paths.filter(Boolean);
}

const GRID = diskGrid();

function SolarDiskBoard({
  images,
  regions,
  issued,
}: {
  images: SolarBriefImage[];
  regions: SolarMonitorRegion[];
  issued: string | null;
}) {
  return (
    <div className={styles.block}>
      <h4>Solar disk</h4>
      <p>
        Newest SDO frames with NOAA region numbers. A region just past the limb stays on the edge.
        {issued ? ` Summary issued ${issued}.` : ""} The view refreshes about every five minutes.
      </p>
      <div className={styles.images}>
        {images.map((image) => (
          <LabeledDisk key={`${image.key}-${image.url}`} image={image} regions={regions} />
        ))}
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>n.</th>
              <th>AR</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>Sunspots</th>
              <th>Area</th>
              <th>Magnetic class</th>
              <th>X-ray flare, peak UTC</th>
            </tr>
          </thead>
          <tbody>
            {regions.map((region, index) => (
              <tr key={region.number} className={region.kind === "plage" ? styles.plage : styles.spot}>
                <td>{index + 1}</td>
                <td>{region.number}</td>
                <td>{region.latitude}</td>
                <td className={region.limb ? styles.limb : undefined}>{region.longitude}</td>
                <td>{region.spot_count == null ? "—" : region.spot_count}</td>
                <td>{region.area_millionths == null ? "—" : region.area_millionths}</td>
                <td className={region.magnetic_class === "beta" ? styles.beta : undefined}>
                  {region.magnetic_class ?? "—"}
                </td>
                <td>
                  <div>Yesterday: {region.flare_yesterday ?? "—"}</div>
                  <div>Today: {region.flare_today ?? "—"}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Green rows have sunspots. Grey rows are plages without spots. A flare is shown only when NOAA
        assigns that X-ray event to the region. Today stays partial until the UTC day ends.
      </p>
    </div>
  );
}

function LabeledDisk({ image, regions }: { image: SolarBriefImage; regions: SolarMonitorRegion[] }) {
  const [src, setSrc] = useState(image.url);
  const labeled = regions.filter((region) => region.label_x != null && region.label_y != null);
  return (
    <figure>
      <div className={styles.disk}>
        <img
          src={src}
          alt={`${image.title}${image.image_time ? `, ${image.image_time}` : ""}`}
          onError={() => {
            if (src !== image.fallback_url) setSrc(image.fallback_url);
          }}
        />
        <svg className={styles.grid} viewBox="0 0 100 100" aria-hidden>
          {GRID.map((path, index) => (
            <path key={index} d={path} />
          ))}
        </svg>
        {labeled.map((region) => (
          <span
            key={region.number}
            className={styles.regionLabel}
            style={{ left: `${(region.label_x ?? 0) * 100}%`, top: `${(region.label_y ?? 0) * 100}%` }}
          >
            {region.number}
          </span>
        ))}
      </div>
      <figcaption>
        {image.title}
        {image.image_time ? ` · ${image.image_time}` : ""} · SDO
      </figcaption>
    </figure>
  );
}

function BriefImage({ image }: { image: SolarBriefImage }) {
  const [src, setSrc] = useState(image.url);
  return (
    <figure>
      <img
        src={src}
        alt={`${image.title} from SolarHam`}
        onError={() => {
          if (src !== image.fallback_url) setSrc(image.fallback_url);
        }}
      />
      <figcaption>
        {image.title} · {src === image.url ? "SolarHam" : "NASA SDO"}
      </figcaption>
    </figure>
  );
}
