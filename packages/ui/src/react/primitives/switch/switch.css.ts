import { tokens } from '@emdash/theme';
import { recipe, style } from '@styles/index';
import type { VariantProps } from '@styles/index';
import { switchHiddenInputAdapter } from './switch-hidden-input.adapter.css';

// Pre-created base so the thumb and hidden-input selectors can reference it.
const switchBase = style({
  display: 'inline-flex',
  position: 'relative',
  flexShrink: 0,
  cursor: 'pointer',
  borderRadius: '9999px',
  border: '1px solid transparent',
  outline: 'none',
  transition: 'background-color 150ms, border-color 150ms',
  backgroundColor: tokens.surface.current.hover,
  selectors: {
    '&:focus-visible': {
      borderColor: tokens.border.focus,
      boxShadow: `0 0 0 3px color-mix(in srgb, ${tokens.border.focus} 30%, transparent)`,
    },
    '&[data-checked]': {
      backgroundColor: tokens.palette.accent.step9,
    },
    '&[data-disabled]': {
      pointerEvents: 'none',
      opacity: 0.5,
    },
  },
});

export const switchRoot = recipe({
  base: [switchBase, switchHiddenInputAdapter],
  variants: {
    size: {
      base: { width: '2rem', height: '1.125rem' },
      sm: { width: '1.5rem', height: '0.875rem' },
    },
  },
  defaultVariants: { size: 'base' },
});

export type SwitchVariants = NonNullable<VariantProps<typeof switchRoot>>;

export const switchThumb = style({
  position: 'absolute',
  top: '50%',
  left: '0.125rem',
  transform: 'translateY(-50%)',
  width: '0.75rem',
  height: '0.75rem',
  borderRadius: '9999px',
  backgroundColor: tokens.foreground.default,
  transition: 'left 150ms',
  pointerEvents: 'none',
  selectors: {
    [`${switchBase}[data-checked] &`]: {
      left: 'calc(100% - 0.125rem - 0.75rem)',
    },
    [`${switchBase}[data-size="sm"] &`]: {
      width: '0.625rem',
      height: '0.625rem',
    },
    [`${switchBase}[data-size="sm"][data-checked] &`]: {
      left: 'calc(100% - 0.125rem - 0.625rem)',
    },
  },
});
