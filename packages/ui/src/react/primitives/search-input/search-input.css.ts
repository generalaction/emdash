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
      vars: {
        [shortcutDisplay]: 'none',
      },
    },
  },
});

/** Search icon pinned to the left, non-interactive. */
export const icon = recipe({
  base: {
    pointerEvents: 'none',
    position: 'absolute',
    left: '0.625rem',
    flexShrink: 0,
    color: tokens.foreground.muted,
    vars: {
      [iconSizeVar]: '0.875rem',
    },
  },
  variants: {
    bare: {
      false: {},
      true: {
        left: 0,
      },
    },
  },
  defaultVariants: {
    bare: false,
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
    bare: {
      false: {},
      true: {
        vars: {
          [fieldControlVars.paddingLeft]: '1.375rem',
        },
      },
    },
  },
  defaultVariants: {
    size: 'base',
    clearable: false,
    bare: false,
  },
});

/** Field anatomy without a standalone shell for an existing owning surface. */
export const bareControl = style({
  border: 0,
  borderRadius: 0,
  backgroundColor: 'transparent',
  color: tokens.foreground.default,
  outline: 'none',
  boxShadow: 'none',
  selectors: {
    '&:disabled': {
      pointerEvents: 'none',
      cursor: 'not-allowed',
      opacity: 0.5,
    },
    '&:read-only': {
      cursor: 'default',
    },
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
