import { describe, expect, it } from 'vitest';
import type { Theme } from '@core/primitives/app-settings/api';
import { DEFAULT_THEME_PROFILE_SELECTION } from '@core/primitives/theme/api/theme-profile-selection';
import { getNextTheme } from './theme-toggle-model';

function theme(colorScheme: Theme['colorScheme']): Theme {
  return { ...DEFAULT_THEME_PROFILE_SELECTION, colorScheme };
}

describe('getNextTheme', () => {
  it('toggles explicit light to dark', () => {
    expect(getNextTheme(theme('light'), 'emlight')).toEqual(theme('dark'));
  });

  it('toggles explicit dark to light', () => {
    expect(getNextTheme(theme('dark'), 'emdark')).toEqual(theme('light'));
  });

  it('uses system light when no explicit theme is selected', () => {
    expect(getNextTheme(theme(null), 'emlight')).toEqual(theme('dark'));
  });

  it('uses system dark when no explicit theme is selected', () => {
    expect(getNextTheme(theme(null), 'emdark')).toEqual(theme('light'));
  });
});
