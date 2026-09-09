import { nativeTheme } from 'electron';
import type { Theme } from '@core/primitives/app-settings/api';
import { resolveThemePolarity } from '@core/primitives/theme/api/theme-profile-selection';
import { getAppSettingsService } from '@main/bootstrap/core/service-instances';
import { log } from '@main/lib/logger';

type EffectiveTheme = 'emlight' | 'emdark';

export function resolveEffectiveTheme(theme: Theme, shouldUseDarkColors: boolean): EffectiveTheme {
  return resolveThemePolarity(theme, shouldUseDarkColors) === 'dark' ? 'emdark' : 'emlight';
}

export async function getTerminalColorEnv(): Promise<Record<string, string>> {
  try {
    const appTheme = await getAppSettingsService().get('theme');
    const effective = resolveEffectiveTheme(appTheme, nativeTheme.shouldUseDarkColors);
    return { COLORFGBG: effective === 'emlight' ? '0;15' : '15;0' };
  } catch (error) {
    log.warn('terminal-color-scheme: failed to resolve app theme for COLORFGBG', {
      error: String(error),
    });
    return {};
  }
}
