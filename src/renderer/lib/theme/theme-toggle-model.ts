import type { Theme } from '@shared/app-settings';

export function getNextTheme(
  current: Theme,
  fallbackEffectiveTheme: NonNullable<Theme>
): NonNullable<Theme> {
  const effectiveTheme = current ?? fallbackEffectiveTheme;
  return effectiveTheme === 'emlight' ? 'emdark' : 'emlight';
}
