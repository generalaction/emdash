import { tokens } from '@emdash/theme';
import { recipe, style } from '@styles/index';

type CSSExtra = { [key: string]: string };

export const wrapper = style({
  position: 'sticky',
  top: 0,
  alignSelf: 'start',
  boxSizing: 'border-box',
  display: 'flex',
  minHeight: '100vh',
  maxHeight: '100vh',
  flexDirection: 'column',
  paddingTop: '2.5rem',
  paddingBottom: '0.75rem',
});

export const dragRegion = style({
  ...({ WebkitAppRegion: 'drag' } as CSSExtra),
});

export const header = style({
  width: '13rem',
  flexShrink: 0,
  marginBottom: '0.75rem',
  ...({ WebkitAppRegion: 'no-drag' } as CSSExtra),
});

export const nav = style({
  display: 'flex',
  width: '13rem',
  flex: 1,
  flexDirection: 'column',
  gap: '0.0625rem',
  minHeight: 0,
  overflowY: 'auto',
  paddingBottom: '2.5rem',
  ...({ WebkitAppRegion: 'no-drag' } as CSSExtra),
});

export const footer = style({
  width: '13rem',
  flexShrink: 0,
  marginTop: '0.75rem',
  ...({ WebkitAppRegion: 'no-drag' } as CSSExtra),
});

export const emptyMessage = style({
  padding: '0.5rem 0.75rem',
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.passive,
});

export const navItem = recipe({
  base: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: '0.5rem',
    borderRadius: tokens.radius.md,
    border: 'none',
    backgroundColor: 'transparent',
    paddingLeft: '0.75rem',
    paddingRight: '0.75rem',
    height: '32px',
    fontSize: tokens.typography.size.sm,
    fontWeight: 400,
    color: tokens.foreground.muted,
    cursor: 'pointer',
    transition: 'background-color 150ms, box-shadow 150ms, color 150ms',
    textAlign: 'left',
    selectors: {
      '&:hover:not(:disabled)': {
        backgroundColor: tokens.palette.neutral.step2,
        color: tokens.foreground.default,
      },
      '&:focus-visible': {
        outline: `2px solid ${tokens.border.focus}`,
        outlineOffset: '-2px',
      },
    },
  },
  variants: {
    selected: {
      true: {
        backgroundColor: tokens.palette.neutral.step4,
        color: tokens.foreground.default,
        selectors: {
          '&:hover:not(:disabled)': {
            backgroundColor: tokens.palette.neutral.step4,
            color: tokens.foreground.default,
          },
        },
      },
    },
    disabled: {
      true: {
        cursor: 'not-allowed',
        opacity: 0.5,
      },
    },
  },
  defaultVariants: {
    selected: false,
    disabled: false,
  },
});

// ── Icon + external-link icon ─────────────────────────────────────────────────

export const navItemIcon = style({
  color: 'inherit',
});

export const navItemLabel = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const badge = style({
  marginLeft: 'auto',
  fontSize: tokens.typography.size.xs,
  color: tokens.foreground.passive,
  fontVariantNumeric: 'tabular-nums',
});

export const externalIcon = style({
  color: tokens.foreground.muted,
  marginLeft: 'auto',
});

// ── Divider ───────────────────────────────────────────────────────────────────

export const divider = style({
  width: '100%',
  paddingTop: '0.5rem',
  paddingBottom: '0.5rem',
  selectors: {
    '&::before': {
      content: "''",
      display: 'block',
      width: '100%',
      height: '1px',
      backgroundColor: tokens.border.default,
    },
  },
});

export const sectionLabel = style({
  width: '100%',
  paddingTop: '1.25rem',
  paddingRight: '0.75rem',
  paddingBottom: '0.75rem',
  paddingLeft: '0.75rem',
  fontSize: tokens.typography.size.sm,
  fontWeight: 400,
  lineHeight: 1,
  letterSpacing: '-0.015em',
  color: tokens.foreground.passive,
});
