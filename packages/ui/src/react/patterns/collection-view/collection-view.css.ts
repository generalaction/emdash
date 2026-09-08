import { tokens } from '@emdash/theme';
import { recipe, style } from '@styles/index';

export const columnTemplateVar = '--_collection-view-template';

export const root = style({
  display: 'flex',
  width: '100%',
  height: '100%',
  minHeight: 0,
  flexDirection: 'column',
  overflow: 'hidden',
  borderRadius: tokens.radius.lg,
  backgroundColor: tokens.surface.current.background,
});

/** Default loading slot: centered spinner. */
export const loading = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  padding: '2rem',
});

export const rowGrid = style({
  display: 'grid',
  width: '100%',
  gridTemplateColumns: `var(${columnTemplateVar})`,
  alignItems: 'center',
  columnGap: tokens.space.step3,
  paddingInline: '0.75rem',
});

const bodyCellBase = style({
  minWidth: 0,
  selectors: {
    "&[data-align='start']": {
      alignSelf: 'start',
    },
    "&[data-align='end']": {
      alignSelf: 'end',
    },
  },
});

export const bodyCell = recipe({
  base: bodyCellBase,
  variants: {
    density: {
      default: { paddingBlock: '0.75rem' },
      compact: { paddingBlock: '0.375rem' },
    },
  },
  defaultVariants: {
    density: 'default',
  },
});

const freeformBase = style({
  display: 'flex',
  width: '100%',
  minWidth: 0,
  alignItems: 'center',
  gap: tokens.space.step3,
  paddingInline: '0.75rem',
});

export const freeform = recipe({
  base: freeformBase,
  variants: {
    density: {
      default: { paddingBlock: '0.75rem' },
      compact: { paddingBlock: '0.375rem' },
    },
  },
  defaultVariants: {
    density: 'default',
  },
});

export const cell = style({
  display: 'flex',
  minWidth: 0,
  flexDirection: 'column',
  gap: '0.125rem',
});

export const cellPrimary = style({
  overflow: 'hidden',
  fontSize: tokens.typography.size.sm,
  lineHeight: tokens.typography.lineHeight.sm,
  color: tokens.foreground.default,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const cellSecondary = style({
  overflow: 'hidden',
  fontSize: tokens.typography.size.xs,
  lineHeight: tokens.typography.lineHeight.xs,
  color: tokens.foreground.muted,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
