import { tokens } from '@emdash/theme';
import { recipe, style } from '@styles/index';
import { fieldControlVars } from '@styles/recipes/field-control-contract';
import { iconSizeVar } from '@styles/recipes/icon-contract';

const shortcutDisplay = '--_search-input-shortcut-display';

/** Wrapper that provides the positioning context for the icon. */
export const container = style({
  position: 'relative',
  display: 'flex',
  minWidth: 0,
  alignItems: 'center',
  width: '100%',
  selectors: {
    '&:has(input:not(:placeholder-shown))': {
      [shortcutDisplay]: 'none',
    },
  },
});

/** Search icon pinned to the left, non-interactive. */
export const icon = style({
  pointerEvents: 'none',
  position: 'absolute',
  left: '0.625rem',
  flexShrink: 0,
  color: tokens.foreground.muted,
  vars: {
    [iconSizeVar]: '0.875rem',
  },
});

/** Input-slot anatomy layered over the public field-control Recipe. */
export const control = recipe({
  base: {
    vars: {
      [fieldControlVars.paddingLeft]: '2rem',
    },
  },
  variants: {
    size: {
      base: {},
      sm: {
        vars: {
          [fieldControlVars.paddingLeft]: '1.75rem',
        },
      },
    },
    clearable: {
      false: {},
      true: {
        vars: {
          [fieldControlVars.paddingRight]: '1.875rem',
        },
      },
    },
  },
  defaultVariants: {
    size: 'base',
    clearable: false,
  },
});

/** Optional shortcut/help content pinned to the trailing edge and vertically centered. */
export const shortcut = style({
  pointerEvents: 'none',
  position: 'absolute',
  right: '0.5rem',
  top: '50%',
  transform: 'translateY(-50%)',
  display: `var(${shortcutDisplay}, inline-flex)`,
  alignItems: 'center',
  gap: tokens.space.step0_5,
  color: tokens.foreground.muted,
});

/** Clear button pinned to the right. */
export const clearButton = style({
  pointerEvents: 'auto',
  position: 'absolute',
  right: '0.375rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '1.25rem',
  height: '1.25rem',
  borderRadius: tokens.radius.sm,
  border: 'none',
  backgroundColor: 'transparent',
  color: tokens.foreground.muted,
  cursor: 'pointer',
  transition: 'color 150ms, background-color 150ms',
  vars: {
    [iconSizeVar]: '0.75rem',
  },
  selectors: {
    '&:hover': {
      backgroundColor: tokens.surface.current.hover,
      color: tokens.foreground.default,
    },
    '&:focus-visible': {
      outline: 'none',
      boxShadow: `0 0 0 2px ${tokens.border.focus}`,
    },
  },
});
