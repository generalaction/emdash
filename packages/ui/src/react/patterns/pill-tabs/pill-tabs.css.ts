import { tokens } from '@emdash/theme';
import { recipe, style, sx } from '@styles/index';
import { iconSizeVar } from '@styles/recipes/icon-contract';

const motion = {
  transitionDuration: '200ms',
  transitionTimingFunction: 'ease-out',
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      transitionDuration: '0ms',
    },
  },
} as const;

export const list = style({
  display: 'flex',
  width: '100%',
  alignItems: 'stretch',
  gap: '0.5rem',
});

export const slot = recipe({
  base: {
    display: 'flex',
    minWidth: 0,
    transitionProperty: 'flex-grow, flex-basis',
    ...motion,
  },
  variants: {
    compact: {
      false: {
        flexBasis: 0,
        flexGrow: 1,
        flexShrink: 1,
      },
      true: {
        flexBasis: '6rem',
        flexGrow: 0,
        flexShrink: 0,
      },
    },
  },
  defaultVariants: {
    compact: false,
  },
});

export const tab = style([
  sx({ px: '5', py: '2' }),
  {
    display: 'inline-flex',
    width: '100%',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px solid ${tokens.border.default}`,
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.surface.level.elevated.background,
    color: tokens.foreground.muted,
    font: 'inherit',
    cursor: 'pointer',
    transition: 'background-color 150ms, border-color 150ms, color 150ms',
    selectors: {
      '&:hover:not([data-disabled]):not([aria-disabled="true"])': {
        backgroundColor: tokens.surface.level.elevated.hover,
      },
      '&[data-selected], &[aria-selected="true"]': {
        borderColor: tokens.border.focus,
        backgroundColor: tokens.surface.level.elevated.selected,
        color: tokens.foreground.default,
      },
      '&:disabled, &[data-disabled], &[aria-disabled="true"]': {
        cursor: 'not-allowed',
        opacity: 0.5,
      },
      '&:focus-visible': {
        outline: 'none',
        borderColor: tokens.border.focus,
        boxShadow: `0 0 0 3px color-mix(in srgb, ${tokens.border.focus} 30%, transparent)`,
      },
    },
  },
]);

export const content = style({
  display: 'flex',
  width: '100%',
  minWidth: 0,
  alignItems: 'center',
  justifyContent: 'center',
});

export const icon = style({
  flexShrink: 0,
  vars: {
    [iconSizeVar]: '0.75rem',
  },
});

export const label = recipe({
  base: {
    minWidth: 0,
    overflow: 'hidden',
    fontSize: tokens.typography.size.xs,
    lineHeight: 1.25,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    transitionProperty: 'max-width, margin-left, opacity',
    ...motion,
  },
  variants: {
    hidden: {
      false: {
        maxWidth: '16rem',
        marginLeft: '0.5rem',
        opacity: 1,
      },
      true: {
        maxWidth: 0,
        marginLeft: 0,
        opacity: 0,
      },
    },
  },
  defaultVariants: {
    hidden: false,
  },
});
