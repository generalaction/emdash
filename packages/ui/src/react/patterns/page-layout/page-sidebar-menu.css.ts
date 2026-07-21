import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import type { RecipeVariants } from '@vanilla-extract/recipes';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

type CSSExtra = { [key: string]: string };

// ── Wrapper + nav ─────────────────────────────────────────────────────────────

export const wrapper = style({
  position: 'sticky',
  top: 0,
  alignSelf: 'start',
  paddingTop: '2.5rem',
  paddingBottom: '2.5rem',
});

export const nav = style({
  display: 'flex',
  width: '13rem',
  flexDirection: 'column',
  gap: '0.125rem',
  ...({ WebkitAppRegion: 'no-drag' } as CSSExtra),
});

// ── Nav item button recipe ────────────────────────────────────────────────────

export const navItem = recipe({
  base: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: '0.5rem',
    borderRadius: tokenVars.radiusMd,
    border: 'none',
    backgroundColor: 'transparent',
    paddingLeft: '0.75rem',
    paddingRight: '0.75rem',
    paddingTop: '0.5rem',
    paddingBottom: '0.5rem',
    fontSize: tokenVars.textSm,
    fontWeight: 400,
    color: vars.foregroundMuted,
    cursor: 'pointer',
    transition: 'background-color 150ms, color 150ms',
    textAlign: 'left',
    selectors: {
      '&:hover': {
        backgroundColor: vars.background1,
        color: vars.foreground,
      },
    },
  },
  variants: {
    active: {
      true: {
        backgroundColor: vars.background2,
        color: vars.foreground,
        selectors: {
          '&:hover': {
            backgroundColor: vars.background2,
            color: vars.foreground,
          },
        },
      },
    },
  },
  defaultVariants: {
    active: false,
  },
});

export type NavItemVariants = NonNullable<RecipeVariants<typeof navItem>>;

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

export const externalIcon = style({
  color: vars.foregroundMuted,
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
      backgroundColor: vars.border,
    },
  },
});

export const dividerLabel = style({
  fontSize: tokenVars.textXs,
  lineHeight: 1,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color: vars.foregroundMuted,
  marginBottom: '0.25rem',
  paddingLeft: '0.75rem',
});
