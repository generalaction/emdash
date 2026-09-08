import { planSpinner } from '@styles/effects.css';

/**
 * In-progress: a dim base ring, a small filled center dot, and a bright arc
 * segment that rotates around the ring like a loading spinner.
 */
export function PlanInProgressIcon() {
  // Circumference for r=6 is about 37.70; 25% is 9.42 dash, 75% is 28.28 gap.
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      stroke-width="1"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="6" opacity="0.3" />
      <circle
        class={planSpinner}
        cx="7"
        cy="7"
        r="6"
        stroke-linecap="round"
        stroke-dasharray="9.42 28.28"
      />
      <circle cx="7" cy="7" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
