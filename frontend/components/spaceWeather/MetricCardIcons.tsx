import type { MetricKey } from "@/lib/spaceWeatherMetrics";

const svgProps = {
  viewBox: "0 0 24 24",
  width: "1em",
  height: "1em",
  fill: "none",
  "aria-hidden": true as const,
  focusable: "false" as const,
};

/** Distinct marks for each primary Space Weather metric card. */
export function MetricCardIcon({ metricKey }: { metricKey: MetricKey }) {
  switch (metricKey) {
    case "solar_activity":
      // Quiet sun with corona — overall solar state
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="4.2" fill="#f5b942" />
          <circle cx="12" cy="12" r="6.4" stroke="#f5b942" strokeWidth="1.2" opacity="0.45" />
          <g stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round">
            <path d="M12 2.8v2.2M12 19v2.2M2.8 12h2.2M19 12h2.2" />
            <path d="M5.2 5.2l1.5 1.5M17.3 17.3l1.5 1.5M17.3 5.2l-1.5 1.5M5.2 17.3l1.5-1.5" />
          </g>
        </svg>
      );
    case "solar_flare":
      // X-ray burst / flare spike from the sun
      return (
        <svg {...svgProps}>
          <circle cx="8.5" cy="14" r="3.6" fill="#f59e0b" />
          <path
            d="M11.2 11.2 14 4.5l1.6 3.4 3.9-1.2-2.2 4.6 3.2 1.1-5.4 2.4z"
            fill="#fb923c"
          />
          <path d="M14.2 8.2 16.6 5" stroke="#fde68a" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case "solar_wind":
      // Plasma stream flowing past Earth
      return (
        <svg {...svgProps}>
          <path d="M3 8.5h11.5" stroke="#38bdf8" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M5 12h14" stroke="#7dd3fc" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M3 15.5h12.5" stroke="#38bdf8" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="19.2" cy="12" r="2.3" fill="#1d4ed8" />
          <path d="M18.2 11.3c.4.2.8.5 1.1.1" stroke="#86efac" strokeWidth="0.8" strokeLinecap="round" />
        </svg>
      );
    case "imf_bz":
      // North–south IMF field lines
      return (
        <svg {...svgProps}>
          <path d="M8 4v16" stroke="#f87171" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M16 4v16" stroke="#60a5fa" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M8 5.5 5.8 8.2M8 5.5 10.2 8.2" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M16 18.5 13.8 15.8M16 18.5 18.2 15.8" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M5 12h14" stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="2 2" />
        </svg>
      );
    case "geomagnetic_storm":
      // Earth in disturbed magnetosphere
      return (
        <svg {...svgProps}>
          <ellipse cx="12" cy="12" rx="9" ry="5.5" stroke="#7dd3fc" strokeWidth="1.3" opacity="0.7" />
          <ellipse cx="12" cy="12" rx="5.5" ry="9" stroke="#38bdf8" strokeWidth="1.3" opacity="0.55" />
          <circle cx="12" cy="12" r="3.4" fill="#1d4ed8" />
          <path d="M10.4 11.2c.5.2 1.2.7 1.7.2.4-.4.8.1 1.3.35" stroke="#86efac" strokeWidth="0.8" strokeLinecap="round" />
          <path d="M4.2 7.5 6 9.2M18 14.8l1.8 1.7" stroke="#fbbf24" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "dst":
      // Ring-current / magnetic depression (not a thermometer)
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="7.2" stroke="#a78bfa" strokeWidth="1.6" />
          <circle cx="12" cy="12" r="4.2" stroke="#c4b5fd" strokeWidth="1.3" strokeDasharray="2.2 1.6" />
          <path d="M12 5.5v13" stroke="#f0abfc" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M8.2 12h7.6" stroke="#f0abfc" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M9.5 8.2 12 12l2.5-3.8" stroke="#e879f9" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "zimbabwe_iono":
      // Ionosphere layers above Earth / TEC
      return (
        <svg {...svgProps}>
          <path d="M4 17.5c2.2-1.2 4.4-1.8 8-1.8s5.8.6 8 1.8" stroke="#67e8f9" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M5 14c2-1.4 4.2-2.1 7-2.1s5 .7 7 2.1" stroke="#22d3ee" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M6.5 10.5c1.6-1.3 3.4-1.9 5.5-1.9s3.9.6 5.5 1.9" stroke="#a78bfa" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="19" r="1.6" fill="#1d4ed8" />
          <path d="M10 7.2 12 4.8 14 7.2" stroke="#c4b5fd" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "gnss_risk":
      // GNSS constellation / positioning risk
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="13.5" r="4" fill="#1d4ed8" />
          <path d="M10.5 12.6c.45.2 1.1.65 1.55.15.35-.4.75.1 1.2.3" stroke="#86efac" strokeWidth="0.8" strokeLinecap="round" />
          <circle cx="6" cy="6.5" r="1.2" fill="#7dd3fc" />
          <circle cx="18" cy="6.2" r="1.2" fill="#7dd3fc" />
          <circle cx="19.2" cy="14.5" r="1.1" fill="#7dd3fc" />
          <path d="M6 7.5 10.2 11.2M18 7.2 14 11M19 14.2 15.4 14.5" stroke="#38bdf8" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      );
    case "stations":
      // CORS / GNSS reference station dish
      return (
        <svg {...svgProps}>
          <path d="M7 16.5c0-3.6 2.9-6.5 6.5-6.5" stroke="#38bdf8" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M7 16.5c0-5.5 4.5-10 10-10" stroke="#7dd3fc" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
          <circle cx="7" cy="16.5" r="1.5" fill="#38bdf8" />
          <path d="M7 18v2.5h4" stroke="#94a3b8" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="16.5" cy="10" r="1.1" fill="#fbbf24" />
        </svg>
      );
    case "donki_flares":
      return (
        <svg {...svgProps}>
          <circle cx="9" cy="14.5" r="3.2" fill="#f59e0b" />
          <path d="M11.5 12 15.5 4.8l1.2 3.1 3.4-.8-1.9 4.2 2.8 1-4.8 2.1z" fill="#fb923c" />
        </svg>
      );
    case "donki_cmes":
      // Expanding CME bubble leaving the Sun
      return (
        <svg {...svgProps}>
          <circle cx="7.5" cy="12" r="3.4" fill="#f59e0b" />
          <path
            d="M11 8.5c2.8-1.2 6.2-.4 8.5 2.2 0 0-1.8 1.1-2.6 3.3-.7 1.9-1.6 3.5-3.4 4.4-2.2-2.4-3.4-5.2-2.5-9.9z"
            fill="#fde68a"
            opacity="0.85"
          />
          <path d="M12.2 10.2c1.6-.4 3.5.1 4.8 1.4" stroke="#fb923c" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case "donki_storms":
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="3.2" fill="#1d4ed8" />
          <path d="M4 9c2.5 1.5 4 3.5 4 3.5S6.5 15 4 16.5" stroke="#fbbf24" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M20 9c-2.5 1.5-4 3.5-4 3.5S17.5 15 20 16.5" stroke="#f87171" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M7.5 5.5 12 3.8 16.5 5.5" stroke="#7dd3fc" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}

/** Compact icons for Solar Wind detail rows. */
export function MetricDetailIcon({ kind }: { kind: string }) {
  switch (kind) {
    case "density":
      return (
        <svg {...svgProps}>
          <circle cx="8" cy="10" r="1.4" fill="#38bdf8" />
          <circle cx="13" cy="8" r="1.1" fill="#7dd3fc" />
          <circle cx="16.5" cy="12" r="1.3" fill="#38bdf8" />
          <circle cx="10.5" cy="15" r="1.2" fill="#7dd3fc" />
          <circle cx="15" cy="16.5" r="0.9" fill="#38bdf8" />
        </svg>
      );
    case "proton_temp":
      return (
        <svg {...svgProps}>
          <path d="M11 4.5v10.2a2.6 2.6 0 1 0 2 0V4.5a1 1 0 0 0-2 0z" stroke="#f472b6" strokeWidth="1.5" />
          <circle cx="12" cy="16.2" r="1.5" fill="#f472b6" />
        </svg>
      );
    case "imf_bz":
      return (
        <svg {...svgProps}>
          <path d="M12 4v16" stroke="#60a5fa" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M12 4 9.5 7M12 4l2.5 3M12 20l-2.5-3M12 20l2.5-3" stroke="#60a5fa" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "imf_bt":
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="6" stroke="#38bdf8" strokeWidth="1.4" />
          <path d="M12 6v12M6 12h12" stroke="#7dd3fc" strokeWidth="1.1" />
          <ellipse cx="12" cy="12" rx="3" ry="6" stroke="#38bdf8" strokeWidth="1.1" />
        </svg>
      );
    case "dyn_pressure":
      return (
        <svg {...svgProps}>
          <path d="M5 14h8l2.5-4H21" stroke="#e2e8f0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14.5 14 17 18l2-2.5" stroke="#fbbf24" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}
