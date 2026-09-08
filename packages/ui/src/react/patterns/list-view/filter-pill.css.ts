import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
import { iconSizeVar } from '@styles/recipes/icon-contract';

// ── FilterPill ────────────────────────────────────────────────────────────────

/** The pill chip for an active filter value. */
export const pill = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  borderRadius: '999px',
  border: `1px solid ${tokens.border.default}`,
  backgroundColor: tokens.surface.current.hover,
  paddingLeft: '0.5rem',
  paddingRight: '0.25rem',
  paddingTop: '0.125rem',
  paddingBottom: '0.125rem',
  fontSize: tokens.typography.size.xs,
  color: tokens.foreground.default,
  whiteSpace: 'nowrap',
});

export const pillAvatar = style({
  width: '0.875rem',
  height: '0.875rem',
  borderRadius: '999px',
  flexShrink: 0,
  objectFit: 'cover',
});

export const pillSwatch = style({
  width: '0.5rem',
  height: '0.5rem',
  borderRadius: '999px',
  flexShrink: 0,
});

export const pillRemove = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '1rem',
  height: '1rem',
  borderRadius: '999px',
  border: 'none',
  backgroundColor: 'transparent',
  color: tokens.foreground.muted,
  cursor: 'pointer',
  transition: 'color 150ms',
  vars: {
    [iconSizeVar]: '0.625rem',
  },
  selectors: {
    '&:hover': { color: tokens.foreground.default },
  },
});

// ── FilterButton ──────────────────────────────────────────────────────────────

/** Ghost popover-trigger button used in the toolbar filter bar. */
export const filterButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  border: 'none',
  backgroundColor: 'transparent',
  padding: 0,
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.muted,
  cursor: 'pointer',
  transition: 'color 150ms',
  vars: {
    [iconSizeVar]: '0.875rem',
  },
  selectors: {
    '&:hover': { color: tokens.foreground.default },
    '&[data-active="true"]': { color: tokens.foreground.default, fontWeight: 400 },
    '&:disabled': { pointerEvents: 'none', opacity: 0.4, cursor: 'not-allowed' },
  },
});
