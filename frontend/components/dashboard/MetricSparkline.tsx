/** Tiny SVG sparkline from real numeric samples — omit when under 2 points. */
export default function MetricSparkline({
  values,
  color = "#168bd2",
  label,
}: {
  values: number[];
  color?: string;
  label?: string;
}) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return null;

  const w = 96;
  const h = 22;
  const padY = 2;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;

  const points = finite
    .map((v, i) => {
      const x = (i / (finite.length - 1)) * w;
      const y = h - padY - ((v - min) / span) * (h - padY * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className="home-metric-sparkline"
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      preserveAspectRatio="none"
      role="img"
      aria-label={label ?? "24-hour trend"}
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
        opacity={0.9}
      />
    </svg>
  );
}
