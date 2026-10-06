import { createVar, style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { textVariants } from '../typography/typography.variants.css';
import { vars } from '@theme/core/contract/contract.css';

export const meterColor = createVar();
export const root = recipe({
  base: { position: 'relative', width: '100%' },
  variants: {
    tone: {
      neutral: { vars: { [meterColor]: vars.foregroundInfo } },
      warning: { vars: { [meterColor]: vars.foregroundWarning } },
      error: { vars: { [meterColor]: vars.foregroundError } },
    },
  },
});
export const track = recipe({
  base: { overflow: 'hidden' },
  variants: {
    size: {
      sm: { height: '0.375rem', borderRadius: '999px', backgroundColor: vars.border },
      lg: { height: '2.5rem', borderRadius: '0.5rem', backgroundColor: vars.surfaceHover },
    },
    striped: {
      true: {
        backgroundColor: 'transparent',
        backgroundImage: `repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, ${meterColor} 25%, transparent) 5px 6px, transparent 6px 10px)`,
      },
    },
  },
});
export const indicator = recipe({
  base: { height: '100%', borderRadius: 'inherit' },
  variants: {
    size: {
      sm: { backgroundColor: meterColor },
      lg: { backgroundColor: `color-mix(in srgb, ${meterColor} 25%, ${vars.surface})` },
    },
  },
});
export const labels = style([
  textVariants({ variant: 'body' }),
  {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    paddingInline: '0.625rem',
    color: vars.foreground,
    pointerEvents: 'none',
  },
]);
export const startLabel = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const endLabel = style([
  textVariants({ variant: 'caption' }),
  {
    flexShrink: 0,
    padding: '0.125rem 0.375rem',
    borderRadius: '0.375rem',
    backgroundColor: `color-mix(in srgb, ${vars.surface} 85%, transparent)`,
  },
]);
