import type { Theme } from '@shared/core/app-settings';

export function getNextTheme(
  current: Theme,
  fallbackEffectiveTheme: NonNullable<Theme>
): NonNullable<Theme> {
  const effectiveTheme = current ?? fallbackEffectiveTheme;
  // Binary dark-side <-> light shortcut: any non-emlight theme (including emwebstorm)
  // toggles to emlight. WebStorm is reachable only via the settings picker, not this toggle.
  return effectiveTheme === 'emlight' ? 'emdark' : 'emlight';
}
