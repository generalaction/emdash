export function Sparkline({
  values,
  height = 48,
  color = 'var(--accent)',
  label,
}: {
  values: number[];
  height?: number;
  color?: string;
  label?: string;
}) {
  const max = Math.max(1, ...values);
  const w = 100;
  const n = Math.max(values.length, 1);
  const bw = w / n;
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={label ?? 'activity over time'}
    >
      {values.map((v, i) => {
        const h = (v / max) * height;
        return (
          <rect
            key={i}
            x={i * bw + bw * 0.15}
            y={height - h}
            width={bw * 0.7}
            height={h}
            rx={0.5}
            fill={color}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}
