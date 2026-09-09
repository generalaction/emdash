import { tokens } from '@emdash/theme';
import { recipe, style } from '@styles/index';

type CSSExtra = { [key: string]: string };

// ── Root ──────────────────────────────────────────────────────────────────────

export const root = recipe({
  base: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
  },
  variants: {
    sticky: {
      true: {
        position: 'sticky',
        top: 0,
        zIndex: 10,
        backgroundColor: tokens.palette.neutral.step1,
        paddingTop: '2.5rem',
      },
    },
  },
  defaultVariants: {
    sticky: false,
  },
});

// ── Title block ───────────────────────────────────────────────────────────────

export const titleBlock = style({
  display: 'flex',
  minWidth: 0,
  flexDirection: 'column',
  gap: '0.25rem',
});

// ── Actions slot ──────────────────────────────────────────────────────────────

export const actions = style({
  display: 'flex',
  minWidth: 0,
  flexDirection: 'column',
  gap: '1rem',
  marginTop: '2rem',
});

export const dragRegion = style({
  ...({ WebkitAppRegion: 'drag' } as CSSExtra),
});

export const noDragRegion = style({
  ...({ WebkitAppRegion: 'no-drag' } as CSSExtra),
});

// ── Separator ─────────────────────────────────────────────────────────────────

export const separator = style({
  height: '1px',
  backgroundColor: tokens.border.default,
  flexShrink: 0,
  marginTop: '1.75rem',
});
