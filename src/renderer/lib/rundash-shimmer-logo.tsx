import { useId } from 'react';
import { EMDASH_PATHS, NATURAL_HEIGHT, NATURAL_WIDTH } from '@renderer/lib/rundash-logo';

export function RundashShimmerLogo({
  className,
  height = NATURAL_HEIGHT,
  color = 'currentColor',
  shimmerColor = 'white',
}: {
  className?: string;
  height?: number;
  color?: string;
  shimmerColor?: string;
}) {
  const uid = useId();
  const gradientId = `logo-shimmer-${uid.replace(/:/g, '')}`;
  const width = (height / NATURAL_HEIGHT) * NATURAL_WIDTH;
  const prefersReduced =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 499 70"
      fill={`url(#${gradientId})`}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1="-499"
          y1="-144"
          x2="0"
          y2="144"
        >
          <stop offset="0%" stopColor={color} stopOpacity="1" />
          <stop offset="25%" stopColor={color} stopOpacity="1" />
          <stop offset="50%" stopColor={shimmerColor} stopOpacity="1" />
          <stop offset="75%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={color} stopOpacity="1" />
          {!prefersReduced && (
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              values="0 0; 998 0; 998 0"
              keyTimes="0; 0.9; 1"
              dur="7s"
              repeatCount="indefinite"
            />
          )}
        </linearGradient>
      </defs>
      {EMDASH_PATHS.map((d) => (
        <path key={d.slice(0, 8)} d={d} />
      ))}
    </svg>
  );
}
