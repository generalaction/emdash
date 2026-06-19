import type { Theme } from '@shared/core/app-settings';
import { resolveEffectiveTheme } from '@shared/core/theme';

const LIGHT_WINDOW_BACKGROUND = '#ffffff';
const DARK_WINDOW_BACKGROUND = '#111111';

export type ElectronThemeSource = 'system' | 'light' | 'dark';

export function getWindowBackgroundColor(theme: Theme, shouldUseDarkColors: boolean): string {
  return resolveEffectiveTheme(theme, shouldUseDarkColors) === 'emdark'
    ? DARK_WINDOW_BACKGROUND
    : LIGHT_WINDOW_BACKGROUND;
}

export function getElectronThemeSource(theme: Theme): ElectronThemeSource {
  if (theme === 'emlight') return 'light';
  if (theme === 'emdark') return 'dark';
  return 'system';
}
