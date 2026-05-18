import type { Theme } from '@shared/app-settings';

export function getNextTheme(current: Theme, prefersDark: boolean): NonNullable<Theme> {
  const effectiveTheme = current ?? (prefersDark ? 'emdark' : 'emlight');
  return effectiveTheme === 'emlight' ? 'emdark' : 'emlight';
}
