import { style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';

type CSSExtra = { [key: string]: string };

// ── Root ──────────────────────────────────────────────────────────────────────

export const header = style({
  display: 'flex',
  flexDirection: 'column',
});

export const headerSticky = style({
  position: 'sticky',
  top: 0,
  zIndex: 10,
  backgroundColor: vars.background,
  paddingTop: '2.5rem',
});

// ── Title block ───────────────────────────────────────────────────────────────

export const titleRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
});

export const titleBlock = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  flex: 1,
  gap: '0.25rem',
  ...({ WebkitAppRegion: 'drag' } as CSSExtra),
});

// ── Actions slot ──────────────────────────────────────────────────────────────

export const titleActions = style({
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  gap: '0.5rem',
  ...({ WebkitAppRegion: 'no-drag' } as CSSExtra),
});

export const actions = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  marginTop: '2rem',
  ...({ WebkitAppRegion: 'no-drag' } as CSSExtra),
});

// ── Separator ─────────────────────────────────────────────────────────────────

export const separator = style({
  height: '1px',
  backgroundColor: vars.border,
  flexShrink: 0,
  marginTop: '1.75rem',
});
