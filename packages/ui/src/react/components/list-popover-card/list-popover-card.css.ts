import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
// Side-effect import so the @layer order declaration is emitted before these
// rules; otherwise `recipes` gets registered first and loses to app layers.

/**
 * Anchors the card just above the bottom edge of the nearest positioned
 * ancestor (the list container), inset from both sides.
 */
export const positioner = style({
  position: 'absolute',
  right: '1.5rem',
  bottom: '1rem',
  left: '1.5rem',
});

export const inner = style({
  display: 'flex',
  overflow: 'hidden',
  alignItems: 'center',
  gap: '0.5rem',
  border: `1px solid ${tokens.surface.current.border}`,
  borderRadius: tokens.radius.md,
  backgroundColor: tokens.surface.current.background,
  padding: '0.5rem',
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.default,
});
