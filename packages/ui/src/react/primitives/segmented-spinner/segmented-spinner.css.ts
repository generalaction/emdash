import { style } from '@styles/index';
import { kfSegmentFade } from '@styles/effects/animations.css';

// ── Segment count and timing ───────────────────────────────────────────────────

const SEGMENTS = 8;
const PERIOD_MS = 900;

// ── Per-segment styles (generated at build time) ──────────────────────────────
//
// Array.from with style() calls is valid VanillaExtract: each style() call is
// evaluated at build time and registers a unique class in the generated CSS.

export const segment = Array.from({ length: SEGMENTS }, (_, i) =>
  style({
    animationName: kfSegmentFade,
    animationDuration: `${PERIOD_MS}ms`,
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
    // Negative delay so each segment starts at a different point in the cycle.
    // Reversing the index (SEGMENTS - i) % SEGMENTS makes the bright head travel
    // clockwise: segment 0 is bright at t=0, segment 1 at t=step, etc.
    animationDelay: `${-((SEGMENTS - i) % SEGMENTS) * (PERIOD_MS / SEGMENTS)}ms`,
    '@media': {
      '(prefers-reduced-motion: reduce)': {
        animationName: 'none',
        // Render a static pattern at reduced opacity so the icon is still visible.
        opacity: `${0.08 + (1 - 0.08) * ((SEGMENTS - 1 - i) / (SEGMENTS - 1))}`,
      },
    },
  })
);
