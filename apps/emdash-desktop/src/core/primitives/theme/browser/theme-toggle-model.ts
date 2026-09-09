import { COLOR_SCHEME_MANIFEST } from '@emdash/theme/profiles';
import type { Theme } from '@core/primitives/app-settings/api';
import { normalizeThemeProfileSelection } from '@core/primitives/theme/api/theme-profile-selection';

export function getNextTheme(current: Theme, fallbackEffectiveTheme: string): Theme {
  const selection = normalizeThemeProfileSelection(current);
  const currentProfile =
    (selection.colorScheme
      ? COLOR_SCHEME_MANIFEST.find(({ id }) => id === selection.colorScheme)
      : COLOR_SCHEME_MANIFEST.find(({ selector }) => selector === `.${fallbackEffectiveTheme}`)) ??
    COLOR_SCHEME_MANIFEST[0];
  if (!currentProfile) throw new Error('Desktop Theme requires at least one Color scheme profile');

  const nextPolarity = currentProfile.polarity === 'light' ? 'dark' : 'light';
  const nextProfile = COLOR_SCHEME_MANIFEST.find(({ polarity }) => polarity === nextPolarity);
  if (!nextProfile) {
    throw new Error(`Desktop Theme requires a ${nextPolarity} Color scheme profile`);
  }
  return { ...selection, colorScheme: nextProfile.id };
}
