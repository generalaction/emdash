import type { Theme } from '@shared/core/app-settings';

const LIGHT_WINDOW_BACKGROUND = '#ffffff';
const DARK_WINDOW_BACKGROUND = '#111111';

export type EffectiveWindowTheme = 'emlight' | 'emdark';
export type ElectronThemeSource = 'system' | 'light' | 'dark';

export function resolveEffectiveWindowTheme(
  theme: Theme,
  shouldUseDarkColors: boolean
): EffectiveWindowTheme {
  if (theme === 'emlight' || theme === 'emdark') return theme;
  return shouldUseDarkColors ? 'emdark' : 'emlight';
}

export function getWindowBackgroundColor(theme: Theme, shouldUseDarkColors: boolean): string {
  return resolveEffectiveWindowTheme(theme, shouldUseDarkColors) === 'emdark'
    ? DARK_WINDOW_BACKGROUND
    : LIGHT_WINDOW_BACKGROUND;
}

export function getElectronThemeSource(theme: Theme): ElectronThemeSource {
  if (theme === 'emlight') return 'light';
  if (theme === 'emdark') return 'dark';
  return 'system';
}
