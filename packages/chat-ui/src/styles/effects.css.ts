/**
 * effects.css.ts — ports the @utility effects from the old tokens.css §3.
 *
 * text-shimmer, fade-overlay-top/bottom, and plan-spinner are now typed VE
 * style objects. Components import the class names directly instead of using
 * Tailwind utility strings.
 *
 * The keyframe names are scoped by VE so they never collide in the host app.
 */

import { createVar, fallbackVar, keyframes, style } from '@vanilla-extract/css';
import { vars } from './theme.css';

// ── Keyframes ─────────────────────────────────────────────────────────────────

const shimmerMove = keyframes({
  from: { backgroundPosition: '200% 0' },
  to: { backgroundPosition: '-200% 0' },
});

const planSpin = keyframes({
  to: { transform: 'rotate(360deg)' },
});

const fadeIn = keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

// ── text-shimmer ──────────────────────────────────────────────────────────────

export const textShimmer = style({
  background: `linear-gradient(
    90deg,
    ${vars.fgPassive} 0%,
    ${vars.fgPassive} 30%,
    ${vars.fgMuted} 50%,
    ${vars.fgPassive} 70%,
    ${vars.fgPassive} 100%
  )`,
  backgroundSize: '200% 100%',
  backgroundClip: 'text',
  WebkitBackgroundClip: 'text',
  color: 'transparent',
  WebkitTextFillColor: 'transparent',
  animation: `${shimmerMove} 3s linear infinite`,
});

// ── fade-overlay-top ──────────────────────────────────────────────────────────

export const fadeOverlayTop = style({
  background: `linear-gradient(
    to bottom,
    ${vars.bg} 0%,
    color-mix(in oklab, ${vars.bg}, transparent 50%) 40%,
    color-mix(in oklab, ${vars.bg}, transparent 100%) 100%
  )`,
});

// ── fade-overlay-bottom ───────────────────────────────────────────────────────

export const fadeOverlayBottom = style({
  background: `linear-gradient(
    to top,
    ${vars.bg} 0%,
    color-mix(in oklab, ${vars.bg}, transparent 50%) 40%,
    color-mix(in oklab, ${vars.bg}, transparent 100%) 100%
  )`,
});

// ── stream-word ───────────────────────────────────────────────────────────────

/**
 * Duration of the per-word fade-in. Override on any ancestor (e.g. ChatRoot or
 * a story container) to tune the effect without rebuilding the stylesheet.
 */
export const streamWordDuration = createVar();

/**
 * Applied to each newly-revealed word span during streaming. A pure paint-only
 * fade (`opacity`), so it never reflows: pretext geometry and the reserved
 * block height are untouched. `inline-block` keeps exact character widths inside
 * the `white-space: pre` fragment.
 */
export const streamWord = style({
  display: 'inline-block',
  // easeOutCubic — a soft, decelerating curve so words settle gently.
  animation: `${fadeIn} ${fallbackVar(streamWordDuration, '200ms')} cubic-bezier(0.215, 0.61, 0.355, 1) both`,
});

// ── plan-spinner ──────────────────────────────────────────────────────────────

export const planSpinner = style({
  transformOrigin: 'center',
  transformBox: 'fill-box',
  animation: `${planSpin} 1s linear infinite`,
});
