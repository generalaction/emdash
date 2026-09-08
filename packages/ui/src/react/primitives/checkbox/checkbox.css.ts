import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
import { iconSizeVar } from '@styles/recipes/icon-contract';

export const root = style({
  position: 'relative',
  display: 'flex',
  width: '1rem',
  height: '1rem',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  borderRadius: '4px',
  border: `1px solid ${tokens.border.muted}`,
  backgroundColor: 'transparent',
  color: tokens.foreground.default,
  outline: 'none',
  transition: 'border-color 150ms, background-color 150ms',
  selectors: {
    // Enlarged hit target: clicks land on the ::after box, not just the 1rem square.
    '&::after': {
      content: '""',
      position: 'absolute',
      top: '-0.5rem',
      bottom: '-0.5rem',
      left: '-0.75rem',
      right: '-0.75rem',
    },
    '&:focus-visible': {
      borderColor: tokens.border.focus,
      boxShadow: `0 0 0 3px color-mix(in srgb, ${tokens.border.focus} 30%, transparent)`,
    },
    '&[data-checked]': {
      borderColor: tokens.border.focus,
      backgroundColor: tokens.palette.neutral.step12,
      color: tokens.palette.neutral.step1,
    },
    // base-ui sets data-disabled both for a direct `disabled` prop and when the
    // checkbox sits inside a disabled Field — this covers the legacy
    // group-has-disabled/field dimming.
    '&[data-disabled]': {
      cursor: 'not-allowed',
      opacity: 0.5,
    },
    '&[data-invalid]': {
      borderColor: tokens.border.destructive,
    },
  },
});

export const indicator = style({
  display: 'grid',
  placeContent: 'center',
  color: 'currentColor',
  vars: {
    [iconSizeVar]: '0.75rem',
  },
});
