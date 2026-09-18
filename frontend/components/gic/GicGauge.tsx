"use client";

interface Segment {
  /** Fraction of the dial where this segment starts (0–1). */
  from: number;
  to: number;
  color: string;
}

interface Props {
  /** Current value, or null when no real data is available. */
  value: number | null;
  min: number;
  max: number;
  segments: Segment[];
  /** Big text under the needle, e.g. "28.7 A" or "72%". */
  valueText: string;
  label?: string;
  size?: number;
}

/** Semicircular dial gauge (SVG). Renders a grey face and no needle when value is null. */
export default function GicGauge({ value, min, max, segments, valueText, label, size = 170 }: Props) {
  const w = size;
  const h = size * 0.62;
  const cx = w / 2;
  const cy = h * 0.92;
  const rOuter = w * 0.44;
  const rInner = w * 0.30;

  const polar = (r: number, frac: number) => {
    const angle = Math.PI * (1 - frac); // 0 → left (180°), 1 → right (0°)
    return [cx + r * Math.cos(angle), cy - r * Math.sin(angle)];
  };

  const arcPath = (from: number, to: number) => {
    const [x0, y0] = polar(rOuter, from);
    const [x1, y1] = polar(rOuter, to);
    const [x2, y2] = polar(rInner, to);
    const [x3, y3] = polar(rInner, from);
    const large = to - from > 0.5 ? 1 : 0;
    return [
      `M ${x0} ${y0}`,
      `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1}`,
      `L ${x2} ${y2}`,
      `A ${rInner} ${rInner} 0 ${large} 0 ${x3} ${y3}`,
      "Z",
    ].join(" ");
  };

  const frac =
    value == null ? null : Math.max(0, Math.min(1, (value - min) / (max - min)));

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.15rem" }}>
      <svg width={w} height={h} role="img" aria-label={label ?? "gauge"}>
        {segments.map((s, i) => (
          <path key={i} d={arcPath(s.from, s.to)} fill={value == null ? "#2a3648" : s.color} opacity={0.9} />
        ))}
        {frac != null && (() => {
          const [nx, ny] = polar(rInner - 4, frac);
          return (
            <g>
              <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#fff" strokeWidth={2.5} strokeLinecap="round" />
              <circle cx={cx} cy={cy} r={4.5} fill="#fff" />
            </g>
          );
        })()}
        <text x={polar(rOuter + 2, 0)[0]} y={cy + 12} fill="var(--text-muted)" fontSize="9">{min}</text>
        <text x={polar(rOuter + 2, 1)[0] - 10} y={cy + 12} fill="var(--text-muted)" fontSize="9">{max}</text>
      </svg>
      <div style={{ fontSize: "1.25rem", fontWeight: 800, lineHeight: 1 }}>{valueText}</div>
      {label && (
        <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {label}
        </div>
      )}
    </div>
  );
}
