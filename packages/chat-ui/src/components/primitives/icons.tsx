/**
 * Shared SVG icon components.
 *
 * All icons are 14×14, aria-hidden="true", inheriting stroke from currentColor.
 * Import only what you need; tree-shaking keeps unused icons out of the bundle.
 */

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
      class="text-chat-fg-muted shrink-0"
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
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
