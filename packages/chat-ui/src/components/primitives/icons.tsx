/**
 * Shared SVG icon components.
 *
 * All icons are 14×14, aria-hidden="true", inheriting stroke from currentColor.
 * Import only what you need; tree-shaking keeps unused icons out of the bundle.
 */

import { planSpinner } from '../../styles/effects.css';
import { genericFileIcon } from './icons.css';

/** Clipboard / copy icon (two overlapping rectangles). */
export function IconCopy() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="5" width="9" height="9" rx="1" />
      <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
    </svg>
  );
}

/** Check-mark icon used to confirm a copy action. */
export function IconCheck() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <polyline points="2,8 6,12 14,4" />
    </svg>
  );
}

/**
 * Fallback generic-file icon for when no file-type-specific icon is available.
 * Renders at 14×14 with `shrink-0 text-foreground-muted` classes.
 */
export function GenericFileIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={genericFileIcon}
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

/**
 * Image-unavailable icon — shown in the fallback tile for an attachment whose
 * image content could not be resolved (e.g. on reload). Inherits currentColor.
 */
export function ImageOffIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M10.41 10.41a2 2 0 1 1-2.83-2.83" />
      <line x1="13.5" y1="13.5" x2="6" y2="21" />
      <line x1="18" y1="12" x2="21" y2="15" />
      <path d="M3.59 3.59A1.99 1.99 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.55 0 1.052-.22 1.41-.59" />
      <path d="M21 15V5a2 2 0 0 0-2-2H9" />
    </svg>
  );
}

// ── Mention pill kind icons ────────────────────────────────────────────────────

const MENTION_ICON_PROPS = {
  width: '10',
  height: '10',
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round' as const,
  'stroke-linejoin': 'round' as const,
  'aria-hidden': true as const,
};

/** File mention icon (document with folded corner). */
export function MentionFileIcon() {
  return (
    <svg {...MENTION_ICON_PROPS}>
      <path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6L9 2z" />
      <polyline points="9 2 9 6 13 6" />
    </svg>
  );
}

/** Issue mention icon (circle with dot). */
export function MentionIssueIcon() {
  return (
    <svg {...MENTION_ICON_PROPS}>
      <circle cx="8" cy="8" r="5" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Symbol mention icon (curly braces). */
export function MentionSymbolIcon() {
  return (
    <svg {...MENTION_ICON_PROPS}>
      <path d="M5 2C3.9 2 3 2.9 3 4v2c0 1.1-.9 2-2 2 1.1 0 2 .9 2 2v2c0 1.1.9 2 2 2" />
      <path d="M11 2c1.1 0 2 .9 2 2v2c0 1.1.9 2 2 2-1.1 0-2 .9-2 2v2c0 1.1-.9 2-2 2" />
    </svg>
  );
}

/** Custom/at mention icon (@). */
export function MentionAtIcon() {
  return (
    <svg {...MENTION_ICON_PROPS}>
      <circle cx="8" cy="8" r="3" />
      <path d="M11 8c0 2.8 2 4 4 3V7A7 7 0 1 0 8 15" />
    </svg>
  );
}

// ── Plan status icons ─────────────────────────────────────────────────────────
//
// All three are 14×14, viewBox 0 0 14 14, a centered circle (cx/cy 7, r 6,
// stroke-width 1.5) so they share a uniform footprint. Color comes from the
// surrounding `color` via currentColor.

/** Shared base props for the 14×14 plan status icons. */
const PLAN_ICON_PROPS = {
  width: '14',
  height: '14',
  viewBox: '0 0 14 14',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1',
  'aria-hidden': true as const,
};

/** Pending: dotted stroke circle. */
export function PlanPendingIcon() {
  return (
    <svg {...PLAN_ICON_PROPS}>
      <circle cx="7" cy="7" r="6" stroke-linecap="round" stroke-dasharray="1 3" />
    </svg>
  );
}

/**
 * In-progress: a dim base ring, a small filled center dot, and a bright arc
 * segment (25% of the circumference) that rotates around the ring like a
 * loading spinner.
 */
export function PlanInProgressIcon() {
  // Circumference for r=6 ≈ 37.70; 25% ≈ 9.42 dash, 75% ≈ 28.28 gap.
  return (
    <svg {...PLAN_ICON_PROPS}>
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

/** Completed: stroke circle with a check mark in the middle. */
export function PlanCompletedIcon() {
  return (
    <svg {...PLAN_ICON_PROPS}>
      <circle cx="7" cy="7" r="6" />
      <path d="M4.5 7.2 6.2 9 9.6 5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}
