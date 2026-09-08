import { tokens } from '@emdash/theme';
import { recipe } from '@styles/index';
import { iconSizeVar } from './icon-contract';

const enabledHoverSelector =
  '&:not(:disabled):not([aria-disabled="true"]):not([data-disabled]):hover';
const focusSelector = '&:is(:focus, [data-highlighted])';
const selectedSelector = '&:is([aria-selected="true"], [data-selected], [data-checked])';
const openSelector = '&:is([data-popup-open], [data-open])';
const disabledSelector = '&:is(:disabled, [aria-disabled="true"], [data-disabled])';

/**
 * Private implementation for the public `menuItem()` Recipe.
 *
 * Every shared row state stays on the interactive root. Component modules add
 * anatomy-only classes for indicators, labels, and shortcuts.
 */
export const menuItemRecipe = recipe({
  base: {
    position: 'relative',
    display: 'flex',
    cursor: 'default',
    alignItems: 'center',
    gap: '0.5rem',
    borderRadius: tokens.radius.sm,
    paddingTop: '0.375rem',
    paddingBottom: '0.375rem',
    paddingLeft: '0.5rem',
    paddingRight: '0.5rem',
    fontSize: tokens.typography.size.sm,
    outline: 'none',
    userSelect: 'none',
    color: tokens.foreground.default,
    vars: {
      [iconSizeVar]: '1rem',
    },
    selectors: {
      [enabledHoverSelector]: {
        backgroundColor: tokens.surface.current.hover,
        color: tokens.foreground.default,
      },
      [focusSelector]: {
        backgroundColor: tokens.surface.current.hover,
        color: tokens.foreground.default,
      },
      [selectedSelector]: {
        backgroundColor: tokens.surface.current.selected,
        color: tokens.foreground.default,
      },
      [openSelector]: {
        backgroundColor: tokens.surface.current.hover,
        color: tokens.foreground.default,
      },
      [disabledSelector]: {
        pointerEvents: 'none',
        opacity: 0.5,
      },
      '&[data-disabled][data-hoverable-when-disabled]': {
        pointerEvents: 'auto',
        cursor: 'not-allowed',
      },
    },
  },

  variants: {
    tone: {
      neutral: {},
      destructive: {
        color: tokens.palette.red.step11,
        selectors: {
          [enabledHoverSelector]: {
            backgroundColor: tokens.palette.red.step3,
            color: tokens.palette.red.step11,
          },
          [focusSelector]: {
            backgroundColor: tokens.palette.red.step3,
            color: tokens.palette.red.step11,
          },
          [selectedSelector]: {
            backgroundColor: tokens.palette.red.step3,
            color: tokens.palette.red.step11,
          },
        },
      },
    },
    trailingIndicator: {
      true: { paddingRight: '2rem' },
      false: {},
    },
    fullWidth: {
      true: { width: '100%' },
      false: {},
    },
    inset: {
      true: { paddingLeft: '2rem' },
      false: {},
    },
    muted: {
      true: { color: tokens.foreground.muted },
      false: {},
    },
  },

  defaultVariants: {
    tone: 'neutral',
    trailingIndicator: false,
    fullWidth: false,
    inset: false,
    muted: false,
  },
});
