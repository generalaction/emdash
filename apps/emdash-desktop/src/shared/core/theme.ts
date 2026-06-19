import type { Theme } from './app-settings';

export type EffectiveTheme = NonNullable<Theme>;

export function resolveEffectiveTheme(theme: Theme, shouldUseDarkColors: boolean): EffectiveTheme {
  if (theme === 'emlight' || theme === 'emdark') return theme;
  return shouldUseDarkColors ? 'emdark' : 'emlight';
}
