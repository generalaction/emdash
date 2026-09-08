import { tokens } from '@emdash/theme';
import { recipe } from '@styles/index';

export const selectableCard = recipe({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    width: '100%',
    border: `1px solid ${tokens.border.default}`,
    backgroundColor: tokens.surface.level.elevated.background,
    color: tokens.foreground.muted,
    transition: 'background-color 150ms, color 150ms, border-color 150ms',
    cursor: 'pointer',
    selectors: {
      '&:hover': {
        backgroundColor: tokens.surface.level.elevated.hover,
      },
      '&[data-selected="true"], &[aria-selected="true"]': {
        backgroundColor: tokens.surface.level.elevated.selected,
        color: tokens.foreground.default,
        borderColor: tokens.border.focus,
      },
      '&[data-interactive="false"]': {
        color: tokens.foreground.passive,
        cursor: 'default',
      },
      '&[data-interactive="false"]:hover': {
        backgroundColor: tokens.surface.level.elevated.background,
      },
      '&:focus-visible': {
        outline: 'none',
        borderColor: tokens.border.focus,
        boxShadow: `0 0 0 3px color-mix(in srgb, ${tokens.border.focus} 30%, transparent)`,
      },
    },
  },
  variants: {
    justifyContent: {
      'flex-start': { justifyContent: 'flex-start' },
      center: { justifyContent: 'center' },
      'flex-end': { justifyContent: 'flex-end' },
    },
    padding: {
      '2': { padding: tokens.space.step2 },
      '3': { padding: tokens.space.step3 },
    },
    borderRadius: {
      md: { borderRadius: tokens.radius.md },
      lg: { borderRadius: tokens.radius.lg },
    },
  },
  defaultVariants: {
    justifyContent: 'center',
    borderRadius: 'lg',
  },
});
