export function HourHistogram({ byHour, height = 44 }: { byHour: number[]; height?: number }) {
  const max = Math.max(1, ...byHour);
  return (
    <svg
      viewBox={`0 0 24 ${height}`}
      preserveAspectRatio="none"
      className="w-full text-foreground/30"
      style={{ height }}
      role="img"
      aria-label="usage by hour of day"
    >
      {byHour.map((v, h) => {
        const bh = (v / max) * height;
        return (
          <rect
            key={h}
            x={h + 0.15}
            y={height - bh}
            width={0.7}
            height={bh}
            rx={0.2}
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}
