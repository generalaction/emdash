import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';

export const switchRoot = style({
  display: 'inline-flex',
  position: 'relative',
  flexShrink: 0,
  cursor: 'pointer',
  width: '2rem',
  height: '1.125rem',
  borderRadius: '9999px',
  border: '1px solid transparent',
  outline: 'none',
  transition: 'background-color 150ms, border-color 150ms',
  backgroundColor: vars.surfaceHover,
  selectors: {
    '&:focus-visible': {
      borderColor: vars.borderPrimary,
      boxShadow: `0 0 0 3px color-mix(in srgb, ${vars.borderPrimary} 30%, transparent)`,
    },
    '&[data-checked]': {
      backgroundColor: vars.primaryButtonBackground,
    },
    '&[data-disabled]': {
      pointerEvents: 'none',
      opacity: 0.5,
    },
  },
});

export const switchThumb = style({
  position: 'absolute',
  top: '50%',
  left: '0.125rem',
  transform: 'translateY(-50%)',
  width: '0.75rem',
  height: '0.75rem',
  borderRadius: '9999px',
  backgroundColor: vars.foreground,
  transition: 'left 150ms',
  pointerEvents: 'none',
  selectors: {
    [`${switchRoot}[data-checked] &`]: {
      left: 'calc(100% - 0.125rem - 0.75rem)',
    },
  },
});

// Ensure the hidden input doesn't affect layout
globalStyle(`${switchRoot} input[type="checkbox"]`, {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
});
