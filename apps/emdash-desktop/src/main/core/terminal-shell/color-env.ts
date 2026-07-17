import { nativeTheme } from 'electron';
import type { Theme } from '@core/primitives/app-settings/api';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';

type EffectiveTheme = 'emlight' | 'emdark';

export function resolveEffectiveTheme(theme: Theme, shouldUseDarkColors: boolean): EffectiveTheme {
  if (theme === 'emlight' || theme === 'emdark') return theme;
  return shouldUseDarkColors ? 'emdark' : 'emlight';
}

export async function getTerminalColorEnv(): Promise<Record<string, string>> {
  try {
    const appTheme = await appSettingsService.get('theme');
    const effective = resolveEffectiveTheme(appTheme, nativeTheme.shouldUseDarkColors);
    return { COLORFGBG: effective === 'emlight' ? '0;15' : '15;0' };
  } catch (error) {
    log.warn('terminal-color-scheme: failed to resolve app theme for COLORFGBG', {
      error: String(error),
    });
    return {};
  }
}
