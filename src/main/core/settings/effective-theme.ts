import { nativeTheme } from 'electron';
import type { EffectiveTheme } from '@main/core/pty/pty-env';
import { appSettingsService } from './settings-service';

export async function resolveEffectiveTheme(): Promise<EffectiveTheme> {
  const theme = await appSettingsService.get('theme');
  if (theme === 'emlight' || theme === 'emdark') return theme;
  return nativeTheme.shouldUseDarkColors ? 'emdark' : 'emlight';
}
