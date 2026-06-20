/**
 * diff-visual.css.ts — visual styles for Diff.tsx (header + row decoration).
 */

import { style } from '@vanilla-extract/css';
import { vars } from '../../styles/theme.css';
import { textShimmer } from '../../styles/effects.css';

// ── DiffHeader ────────────────────────────────────────────────────────────────

export const diffHeaderBase = style({
  border: `1px solid ${vars.border}`,
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  paddingLeft: '8px',
  paddingRight: '8px',
  cursor: 'pointer',
  fontSize: '0.75rem',
  transition: 'background 150ms',
  selectors: {
    '&:hover': { background: vars.bg3 },
  },
});

export const diffHeaderSolo = style({
  borderRadius: vars.radiusLg,
});

export const diffHeaderWithBody = style({
  borderTopLeftRadius: vars.radiusLg,
  borderTopRightRadius: vars.radiusLg,
  borderBottom: 'none',
});

export const diffFileName = style({
  color: vars.fgMuted,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '0.875rem',
});

export const diffAddsCount = style({ color: vars.diffAdded, flexShrink: 0, fontSize: '0.875rem' });
export const diffDelsCount = style({ color: vars.diffDeleted, flexShrink: 0, fontSize: '0.875rem' });
export const diffSpacer = style({ flex: '1 1 0%' });

// ── DiffLines body ────────────────────────────────────────────────────────────

export const diffBodyCard = style({
  border: `1px solid ${vars.border}`,
  borderBottomLeftRadius: vars.radiusLg,
  borderBottomRightRadius: vars.radiusLg,
  overflow: 'hidden',
});

/** Per-row classes — keyed by DiffRow type. */
export const diffRowClasses = {
  add: style({
    display: 'flex',
    background: `color-mix(in srgb, ${vars.diffAdded} 10%, transparent)`,
    borderLeft: `3px solid ${vars.diffAdded}`,
  }),
  remove: style({
    display: 'flex',
    background: `color-mix(in srgb, ${vars.diffDeleted} 10%, transparent)`,
    borderLeft: `3px solid ${vars.diffDeleted}`,
  }),
  context: style({
    display: 'flex',
    borderLeft: '3px solid transparent',
  }),
} as const;

export const diffLineContent = style({
  color: vars.fg,
  flex: '1 1 0%',
  overflow: 'hidden',
  paddingLeft: '12px',
  paddingRight: '12px',
});

export { textShimmer };
