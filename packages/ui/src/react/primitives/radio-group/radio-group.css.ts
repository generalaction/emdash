import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
import { radioHiddenInputAdapter } from './radio-hidden-input.adapter.css';

export const radioGroup = style({
  display: 'grid',
  width: '100%',
  gap: '0.75rem',
});

export const radioItem = style([
  radioHiddenInputAdapter,
  {
    position: 'relative',
    display: 'inline-flex',
    width: '1rem',
    height: '1rem',
    flexShrink: 0,
    cursor: 'pointer',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px solid ${tokens.border.default}`,
    borderRadius: '9999px',
    backgroundColor: 'transparent',
    outline: 'none',
    transition: 'background-color 150ms, border-color 150ms, box-shadow 150ms',
    selectors: {
      '&:focus-visible': {
        borderColor: tokens.border.focus,
        boxShadow: `0 0 0 3px color-mix(in srgb, ${tokens.border.focus} 30%, transparent)`,
      },
      '&[data-checked]': {
        borderColor: tokens.palette.accent.step9,
        backgroundColor: tokens.palette.accent.step9,
      },
      '&[data-disabled]': {
        pointerEvents: 'none',
        opacity: 0.5,
      },
      '&[data-invalid], &[aria-invalid="true"]': {
        borderColor: tokens.palette.red.step11,
        boxShadow: `0 0 0 3px color-mix(in srgb, ${tokens.palette.red.step11} 20%, transparent)`,
      },
    },
  },
]);

export const radioIndicator = style({
  display: 'flex',
  width: '100%',
  height: '100%',
  alignItems: 'center',
  justifyContent: 'center',
});

export const radioIndicatorDot = style({
  width: '0.375rem',
  height: '0.375rem',
  borderRadius: '9999px',
  backgroundColor: tokens.foreground.inverse,
});
