import { nativeTheme } from 'electron';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import type { Theme } from '@shared/core/app-settings';

type EffectiveTheme = 'emlight' | 'emdark';

export function resolveEffectiveTheme(theme: Theme, shouldUseDarkColors: boolean): EffectiveTheme {
  if (theme === 'emlight' || theme === 'emdark') return theme;
  return shouldUseDarkColors ? 'emdark' : 'emlight';
}

/**
 * Env vars that tell TUIs how emdash's xterm renders output. Only for
 * xterm-rendered PTYs (terminals and agent sessions): ACP hosts must not get it.
 *
 * - COLORFGBG: terminal background for the current app theme, using the
 *   rxvt/konsole "foreground;background" ANSI index convention. Dark terminal ->
 *   "15;0", light terminal -> "0;15". Omitted if the theme can't be resolved.
 * - FORCE_HYPERLINK: makes TUIs emit OSC 8 links, which xterm keeps clickable
 *   even when the TUI hard-wraps a URL. Hyperlink detection doesn't recognize
 *   TERM_PROGRAM=emdash. A user-provided value wins.
 */
export async function getTerminalDisplayEnv(): Promise<Record<string, string>> {
  const env: Record<string, string> = {
    FORCE_HYPERLINK: process.env.FORCE_HYPERLINK ?? '1',
  };
  try {
    const appTheme = await appSettingsService.get('theme');
    const effective = resolveEffectiveTheme(appTheme, nativeTheme.shouldUseDarkColors);
    env.COLORFGBG = effective === 'emlight' ? '0;15' : '15;0';
  } catch (error) {
    log.warn('terminal-color-scheme: failed to resolve app theme for COLORFGBG', {
      error: String(error),
    });
  }
  return env;
}
