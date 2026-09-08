import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
// Side-effect import so the @layer order declaration is emitted before these
// rules; otherwise `recipes` gets registered first and loses to app layers.

export const spinner = style({
  color: tokens.foreground.muted,
  lineHeight: 1,
});
