/**
 * default-typography.ts — bundled copy of the composite type.* design tokens.
 *
 * Source of truth: @emdash/ui/theme/tokens.js type.* entries (tokens.js lines
 * 250-338). Values are replicated here so core/metrics.ts does not need to
 * import the @emdash/ui package at runtime.
 *
 * The --type-* CSS variables declared in tokens.css mirror these numbers so
 * pretext geometry and CSS styling stay in sync.
 *
 * Keep this file up to date when the design token values change in tokens.js.
 */

export type CompositeRole = {
  fontFamily: string[];
  fontSize: { value: number; unit: string };
  fontWeight: number;
  lineHeight: { value: number; unit: string };
  fontStyle?: string;
};

const SANS = ['Inter Variable', 'sans-serif'];
const MONO = ['JetBrains Mono Variable', 'JetBrains Mono', 'Menlo', 'Monaco', 'monospace'];

const px = (value: number) => ({ value, unit: 'px' });

export const DEFAULT_TYPOGRAPHY: Record<string, CompositeRole> = {
  'type.body': {
    fontFamily: SANS,
    fontSize: px(14),
    fontWeight: 400,
    lineHeight: px(20),
  },
  'type.body-bold': {
    fontFamily: SANS,
    fontSize: px(14),
    fontWeight: 600,
    lineHeight: px(20),
  },
  'type.body-italic': {
    fontFamily: SANS,
    fontSize: px(14),
    fontWeight: 400,
    lineHeight: px(20),
    fontStyle: 'italic',
  },
  'type.body-link': {
    fontFamily: SANS,
    fontSize: px(14),
    fontWeight: 400,
    lineHeight: px(20),
  },
  'type.h1': {
    fontFamily: SANS,
    fontSize: px(20),
    fontWeight: 600,
    lineHeight: px(28),
  },
  'type.h2': {
    fontFamily: SANS,
    fontSize: px(17),
    fontWeight: 600,
    lineHeight: px(25),
  },
  'type.h3': {
    fontFamily: SANS,
    fontSize: px(14),
    fontWeight: 600,
    lineHeight: px(22),
  },
  'type.inline-code': {
    fontFamily: MONO,
    fontSize: px(12),
    fontWeight: 400,
    lineHeight: px(20),
  },
  'type.mention': {
    fontFamily: SANS,
    fontSize: px(14),
    fontWeight: 400,
    lineHeight: px(20),
  },
  'type.code': {
    fontFamily: MONO,
    fontSize: px(13),
    fontWeight: 400,
    lineHeight: px(20),
  },
  'type.code-lang': {
    fontFamily: SANS,
    fontSize: px(14),
    fontWeight: 400,
    lineHeight: px(20),
  },
};
