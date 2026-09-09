import { tokens } from '@emdash/theme';
import { style } from '@styles/index';

export const root = style({
  display: 'flex',
  height: '100%',
  minHeight: 0,
  minWidth: 0,
  flexDirection: 'column',
  overflow: 'hidden',
});

export const viewport = style({
  height: '100%',
  padding: '0 0.5rem 0.5rem',
});

export const row = style({
  position: 'relative',
  display: 'flex',
  width: '100%',
  height: '28px',
  alignItems: 'center',
  gap: '0.5rem',
  border: 0,
  borderRadius: '6px',
  backgroundColor: 'transparent',
  padding: '0 8px 0 var(--_search-result-row-indent, 4px)',
  color: tokens.foreground.default,
  font: 'inherit',
  outline: 'none',
  textAlign: 'left',
  userSelect: 'none',
  cursor: 'default',
  selectors: {
    '&:hover': {
      backgroundColor: tokens.palette.neutral.step2,
    },
    '&:focus-visible': {
      boxShadow: `inset 0 0 0 1px ${tokens.border.focus}`,
    },
  },
});

export const chevron = style({
  display: 'inline-flex',
  width: '14px',
  height: '14px',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  color: tokens.foreground.muted,
});

export const label = style({
  display: 'flex',
  minWidth: 0,
  flex: '1 1 auto',
  alignItems: 'baseline',
  gap: '0.375rem',
});

export const name = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: tokens.typography.size.sm,
});

export const secondary = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: tokens.typography.size.xs,
  color: tokens.foreground.muted,
});

export const fileIcon = style({
  flexShrink: 0,
  color: tokens.foreground.muted,
});

export const fileName = style({
  flexShrink: 0,
  fontWeight: 500,
});

export const count = style({
  marginLeft: 'auto',
  flexShrink: 0,
  color: tokens.foreground.muted,
  fontVariantNumeric: 'tabular-nums',
});

export const matchRow = style({
  fontFamily: tokens.typography.family.mono,
  fontSize: '12px',
});

export const lineNumber = style({
  width: '3rem',
  flexShrink: 0,
  paddingRight: '0.5rem',
  textAlign: 'right',
  color: tokens.foreground.muted,
  fontVariantNumeric: 'tabular-nums',
});

export const preview = style({
  minWidth: 0,
  flex: '1 1 auto',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'pre',
});

export const highlight = style({
  borderRadius: '2px',
  backgroundColor: 'rgb(253 224 71 / 0.6)',
  color: 'inherit',
  selectors: {
    '[data-theme="dark"] &': {
      backgroundColor: 'rgb(234 179 8 / 0.35)',
    },
  },
});
