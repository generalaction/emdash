import { style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

type CSSExtra = { [key: string]: string };

// ── Root ──────────────────────────────────────────────────────────────────────

export const header = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '1.5rem',
});

export const headerSticky = style({
  position: 'sticky',
  top: 0,
  zIndex: 10,
  backgroundColor: vars.background,
  paddingTop: '2.5rem',
});

// ── Title block ───────────────────────────────────────────────────────────────

export const titleBlock = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  ...(({ WebkitAppRegion: 'drag' } as CSSExtra)),
});

export const title = style({
  fontSize: '1.25rem',
  lineHeight: '1.75rem',
  fontWeight: 600,
  color: vars.foreground,
});

export const description = style({
  fontSize: tokenVars.textSm,
  color: vars.foregroundMuted,
});

// ── Actions slot ──────────────────────────────────────────────────────────────

export const actions = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  ...(({ WebkitAppRegion: 'no-drag' } as CSSExtra)),
});

// ── Separator ─────────────────────────────────────────────────────────────────

export const separator = style({
  height: '1px',
  backgroundColor: vars.border,
  flexShrink: 0,
  marginTop: '0.25rem',
});
