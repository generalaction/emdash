import {
  COLOR_SCHEME_MANIFEST,
  DENSITY_MANIFEST,
  TYPOGRAPHY_MANIFEST,
  type ColorSchemeId,
  type ColorSchemeManifestEntry,
  type DensityId,
  type TypographyId,
} from '@emdash/theme/profiles';
import type { ThemeProfileIds } from '@emdash/theme/runtime';

export type ThemeProfileSelection = {
  readonly colorScheme: ColorSchemeId | null;
  readonly density: DensityId;
  readonly typography: TypographyId;
};

function firstProfileId<Id extends string>(
  dimension: string,
  entries: readonly { readonly id: Id }[]
): Id {
  const entry = entries[0];
  if (!entry) throw new Error(`Desktop Theme requires at least one ${dimension} profile`);
  return entry.id;
}

export const DEFAULT_THEME_PROFILE_SELECTION: ThemeProfileSelection = {
  colorScheme: null,
  density: firstProfileId('Density', DENSITY_MANIFEST),
  typography: firstProfileId('Typography', TYPOGRAPHY_MANIFEST),
};

function hasProfileId<Id extends string>(
  id: unknown,
  entries: readonly { readonly id: Id }[]
): id is Id {
  return typeof id === 'string' && entries.some((entry) => entry.id === id);
}

function legacyColorSchemeId(value: unknown): ColorSchemeId | null | undefined {
  if (value === null) return null;
  if (value === 'emlight') return 'light';
  if (value === 'emdark') return 'dark';
  return undefined;
}

/**
 * Normalizes persisted Theme data at the settings/cache boundary.
 *
 * Legacy scalar Color scheme values remain readable. Unknown profile ids
 * fall back independently so one stale dimension cannot discard valid peers.
 */
export function normalizeThemeProfileSelection(value: unknown): ThemeProfileSelection {
  const legacyColorScheme = legacyColorSchemeId(value);
  if (legacyColorScheme !== undefined) {
    return {
      ...DEFAULT_THEME_PROFILE_SELECTION,
      colorScheme: legacyColorScheme,
    };
  }

  const candidate =
    typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {};
  const colorScheme = candidate.colorScheme;

  return {
    colorScheme:
      colorScheme === null
        ? null
        : hasProfileId(colorScheme, COLOR_SCHEME_MANIFEST)
          ? colorScheme
          : DEFAULT_THEME_PROFILE_SELECTION.colorScheme,
    density: hasProfileId(candidate.density, DENSITY_MANIFEST)
      ? candidate.density
      : DEFAULT_THEME_PROFILE_SELECTION.density,
    typography: hasProfileId(candidate.typography, TYPOGRAPHY_MANIFEST)
      ? candidate.typography
      : DEFAULT_THEME_PROFILE_SELECTION.typography,
  };
}

function systemColorScheme(prefersDark: boolean): ColorSchemeManifestEntry {
  const polarity = prefersDark ? 'dark' : 'light';
  const profile = COLOR_SCHEME_MANIFEST.find((entry) => entry.polarity === polarity);
  if (!profile) throw new Error(`Desktop Theme requires a ${polarity} Color scheme profile`);
  return profile;
}

export function resolveThemeProfileIds(value: unknown, prefersDark: boolean): ThemeProfileIds {
  const selection = normalizeThemeProfileSelection(value);
  return {
    colorScheme: selection.colorScheme ?? systemColorScheme(prefersDark).id,
    density: selection.density,
    typography: selection.typography,
  };
}

export function resolveThemePolarity(
  value: unknown,
  prefersDark: boolean
): ColorSchemeManifestEntry['polarity'] {
  const { colorScheme } = resolveThemeProfileIds(value, prefersDark);
  const profile = COLOR_SCHEME_MANIFEST.find((entry) => entry.id === colorScheme);
  if (!profile) throw new Error(`Desktop Theme has no Color scheme profile "${colorScheme}"`);
  return profile.polarity;
}
