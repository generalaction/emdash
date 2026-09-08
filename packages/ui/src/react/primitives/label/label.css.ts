import { tokens } from '@emdash/theme';
import { style } from '@styles/index';

/**
 * Shared label typography — the single styling source for both the standalone
 * `Label` and `Field.Label` (field.css.ts composes this).
 */
export const labelBase = style({
  fontSize: tokens.typography.size.base,
  fontWeight: 400,
  lineHeight: 1,
  color: tokens.foreground.default,
  selectors: {
    '&[data-disabled]': { cursor: 'not-allowed', opacity: 0.7 },
  },
});

export const label = style([
  labelBase,
  {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    userSelect: 'none',
  },
]);

export const microLabel = style({
  fontFamily: tokens.typography.family.sans,
  fontSize: tokens.typography.size.xs,
  color: tokens.foreground.passive,
  cursor: 'default',
  userSelect: 'none',
});
