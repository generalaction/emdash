import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { vars } from '@theme/core/contract/contract.css';

export const root = style({ width: '100%' });
export const track = style({
  height: '0.375rem',
  borderRadius: '999px',
  overflow: 'hidden',
  backgroundColor: vars.border,
});
export const indicator = recipe({
  base: { height: '100%', borderRadius: 'inherit' },
  variants: {
    tone: {
      neutral: { backgroundColor: vars.foregroundInfo },
      warning: { backgroundColor: vars.foregroundWarning },
      error: { backgroundColor: vars.foregroundError },
    },
  },
  defaultVariants: { tone: 'neutral' },
});
