import { style } from '@vanilla-extract/css';
import { textVariants } from '../typography/typography.variants.css';
import { vars } from '@theme/core/contract/contract.css';

export const root = style({
  position: 'relative',
  width: '100%',
});
export const track = style({
  overflow: 'hidden',
  height: '2.5rem',
  borderRadius: '0.5rem',
  backgroundColor: vars.surfaceHover,
});
export const indicator = style({
  height: '100%',
  borderRadius: 'inherit',
  backgroundColor: `color-mix(in srgb, ${vars.foregroundMuted} 25%, ${vars.surface})`,
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
