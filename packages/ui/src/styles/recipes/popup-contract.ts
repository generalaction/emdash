import { tokens } from '@emdash/theme';

export type PopupAppearance = 'surface' | 'inverted';
export type PopupLevel = 'base' | 'elevated';
export type PopupMotion = 'enter' | 'none' | 'positioned' | 'scale';
export type PopupRadius = 'none' | 'md' | 'xl';
export type PopupShadow = 'none' | 'sm-plain' | 'sm' | 'md' | 'lg' | 'overlay';

/** @internal Base UI positioning values normalized behind the popup contract. */
export const popupVars = {
  anchorWidth: 'var(--_popup-anchor-width)',
  availableHeight: 'var(--_popup-available-height)',
  availableWidth: 'var(--_popup-available-width)',
  transformOrigin: 'var(--_popup-transform-origin)',
} as const;

const ring = `0 0 0 1px color-mix(in srgb, ${tokens.foreground.default} 10%, transparent)`;

/** @internal Canonical depth values shared with rooted foreign-overlay Adapters. */
export const popupShadowValues = {
  none: 'none',
  'sm-plain': tokens.shadow.sm,
  sm: `${tokens.shadow.sm}, ${ring}`,
  md: `${tokens.shadow.md}, ${ring}`,
  lg: `${tokens.shadow.lg}, ${ring}`,
  overlay: `${tokens.shadow.overlay}, ${ring}`,
} as const satisfies Record<PopupShadow, string>;
