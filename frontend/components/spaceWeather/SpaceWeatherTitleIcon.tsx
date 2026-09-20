/** Inline SVG mark for the Space Weather page title — sun + solar wind / flare. */
export default function SpaceWeatherTitleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="sw-sun-core" cx="38%" cy="38%" r="62%">
          <stop offset="0%" stopColor="#ffe9a8" />
          <stop offset="55%" stopColor="#f5b942" />
          <stop offset="100%" stopColor="#e0891a" />
        </radialGradient>
        <linearGradient id="sw-wind" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.15" />
        </linearGradient>
      </defs>

      {/* Soft corona */}
      <circle cx="15.5" cy="20" r="11.2" fill="#f5b942" opacity="0.18" />

      {/* Short solar rays */}
      <g stroke="#f5b942" strokeWidth="1.6" strokeLinecap="round" opacity="0.9">
        <path d="M15.5 6.2v2.4" />
        <path d="M15.5 31.4v2.4" />
        <path d="M5.4 20h2.4" />
        <path d="M7.8 10.4l1.7 1.7" />
        <path d="M7.8 29.6l1.7-1.7" />
        <path d="M23.2 10.4l-1.7 1.7" />
        <path d="M23.2 29.6l-1.7-1.7" />
      </g>

      {/* Sun disk */}
      <circle cx="15.5" cy="20" r="7.4" fill="url(#sw-sun-core)" />
      <circle cx="13.2" cy="17.6" r="2.1" fill="#fff6d6" opacity="0.45" />

      {/* Flare / CME arc leaving the sun */}
      <path
        d="M22.2 14.8c2.4-0.2 4.6 1.1 6.2 3.4"
        fill="none"
        stroke="#fb923c"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M22.6 25.4c2.6 0.5 4.9-0.5 6.6-2.6"
        fill="none"
        stroke="#fbbf24"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.85"
      />

      {/* Solar-wind particle stream toward Earth */}
      <g fill="url(#sw-wind)">
        <circle cx="27.2" cy="18.2" r="1.05" />
        <circle cx="30.4" cy="19.6" r="0.9" />
        <circle cx="33.4" cy="20.1" r="0.8" />
        <circle cx="28.6" cy="21.8" r="0.85" />
        <circle cx="31.8" cy="22.6" r="0.7" />
        <circle cx="35.2" cy="21.4" r="0.65" />
      </g>

      {/* Tiny Earth glyph receiving the wind */}
      <circle cx="37.2" cy="20.2" r="2.05" fill="#1d4ed8" />
      <path
        d="M35.6 19.4c0.5 0.2 1.1 0.6 1.5 0.2 0.4-0.35 0.7 0.15 1.2 0.35"
        fill="none"
        stroke="#86efac"
        strokeWidth="0.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
