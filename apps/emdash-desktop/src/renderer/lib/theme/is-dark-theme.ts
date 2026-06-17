import type { EffectiveTheme } from '@renderer/lib/providers/theme-provider';

/**
 * Themes that render against a dark background. WebStorm New UI ('emwebstorm')
 * is a variant layered on the dark base, so it counts as dark here. Use this
 * instead of comparing `effectiveTheme === 'emdark'` directly.
 */
export function isDarkTheme(effectiveTheme: EffectiveTheme): boolean {
  return effectiveTheme === 'emdark' || effectiveTheme === 'emwebstorm';
}
