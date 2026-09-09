import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
import { popup } from '@styles/recipes/popup';

export const positioner = style({
  isolation: 'isolate',
  zIndex: 50,
});

export const content = style([
  popup({ appearance: 'inverted' }),
  {
    display: 'inline-flex',
    width: 'fit-content',
    maxWidth: '20rem',
    alignItems: 'center',
    gap: '0.375rem',
    padding: '0.375rem 0.75rem',
    fontSize: tokens.typography.size.xs,
    lineHeight: tokens.typography.lineHeight.xs,
    vars: {
      // Adapt Kbd keycaps rendered inside tooltip content to the inverted
      // surface via the custom-property hooks kbd.css exposes.
      '--_kbd-bg': `color-mix(in srgb, ${tokens.palette.neutral.step1} 15%, transparent)`,
      '--_kbd-border': `color-mix(in srgb, ${tokens.palette.neutral.step1} 20%, transparent)`,
      '--_kbd-color': tokens.palette.neutral.step1,
    },
  },
]);

export const arrow = style({
  zIndex: 50,
  width: '0.625rem',
  height: '0.625rem',
  borderRadius: '2px',
  backgroundColor: tokens.palette.neutral.step12,
  transform: 'translateY(calc(-50% - 2px)) rotate(45deg)',
  selectors: {
    '&[data-side="bottom"]': { top: '0.25rem' },
    '&[data-side="top"]': { bottom: '-0.625rem' },
    '&[data-side="left"], &[data-side="inline-start"]': {
      top: '50%',
      right: '-0.25rem',
      transform: 'translateY(-50%) rotate(45deg)',
    },
    '&[data-side="right"], &[data-side="inline-end"]': {
      top: '50%',
      left: '-0.25rem',
      transform: 'translateY(-50%) rotate(45deg)',
    },
  },
});
