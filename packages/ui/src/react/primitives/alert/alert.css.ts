import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
import { iconSizeVar } from '@styles/recipes/icon-contract';

/**
 * Alert root — a prominent, dismissible notification banner.
 *
 * Visual shell (bg, border, color) comes from the .surface-<status> cascade
 * class applied by the wrapping Surface component.
 */
export const alertRoot = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.75rem',
  borderRadius: tokens.radius.lg,
  border: '1px solid',
  paddingTop: '0.875rem',
  paddingBottom: '0.875rem',
  paddingLeft: '1rem',
  paddingRight: '2.5rem',
  fontSize: tokens.typography.size.sm,
  backgroundColor: tokens.surface.current.background,
  borderColor: tokens.surface.current.border,
  color: tokens.surface.current.foreground,
  selectors: {
    // Reserve room for the top-right action slot so text never runs under it.
    '&:has([data-slot=alert-action])': { paddingRight: '4.5rem' },
  },
});

export const alertIcon = style({
  marginTop: '0.0625rem',
  flexShrink: 0,
  vars: {
    [iconSizeVar]: '1rem',
  },
});

export const alertBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.125rem',
  minWidth: 0,
  flex: '1 1 0%',
});

export const alertTitle = style({
  fontWeight: 400,
  lineHeight: 1.4,
});

export const alertDescription = style({
  lineHeight: 1.5,
  opacity: 0.9,
});

/** Free-form action slot pinned to the top-right corner of the alert. */
export const alertAction = style({
  position: 'absolute',
  top: '0.625rem',
  right: '0.75rem',
  display: 'flex',
  alignItems: 'center',
  gap: '0.25rem',
});

/** Dismiss button pinned to the top-right corner of the alert. */
export const alertDismiss = style({
  position: 'absolute',
  top: '0.5rem',
  right: '0.5rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '1.5rem',
  height: '1.5rem',
  borderRadius: tokens.radius.md,
  border: 'none',
  backgroundColor: 'transparent',
  color: 'inherit',
  opacity: 0.6,
  cursor: 'pointer',
  transition: 'opacity 150ms, background-color 150ms',
  vars: {
    [iconSizeVar]: '0.875rem',
  },
  selectors: {
    '&:hover': { opacity: 1, backgroundColor: tokens.surface.current.hover },
    '&:focus-visible': {
      outline: 'none',
      opacity: 1,
      boxShadow: `0 0 0 2px ${tokens.border.focus}`,
    },
  },
});
