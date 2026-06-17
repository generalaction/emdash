import { nativeTheme } from 'electron';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import type { Theme } from '@shared/core/app-settings';

type EffectiveTheme = 'emlight' | 'emdark';

export function resolveEffectiveTheme(theme: Theme, shouldUseDarkColors: boolean): EffectiveTheme {
  if (theme === 'emlight' || theme === 'emdark') return theme;
  if (theme === 'emwebstorm') return 'emdark';
  return shouldUseDarkColors ? 'emdark' : 'emlight';
}

/**
 * Returns { COLORFGBG } for the current app theme, using the rxvt/konsole
 * convention: "foreground;background" with ANSI palette indices.
 *
 * Light app theme -> "15;0"  (white fg, black bg) — but from the agent's
 * perspective it means the *terminal* bg is light, so agents should pick
 * their light color scheme.
 *
 * Actually: COLORFGBG encodes the terminal bg color, not the app theme.
 * Convention: dark terminal -> "15;0" (fg=white/15, bg=black/0)
 *             light terminal -> "0;15" (fg=black/0, bg=white/15)
 *
 * Returns {} on any error so callers can spread without guarding.
 */
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
