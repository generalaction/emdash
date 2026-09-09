import {
  COLOR_SCHEME_MANIFEST,
  DENSITY_MANIFEST,
  TYPOGRAPHY_MANIFEST,
  type ColorSchemeId,
  type ColorSchemeManifestEntry,
  type DensityId,
  type DensityManifestEntry,
  type TypographyId,
  type TypographyManifestEntry,
} from './profiles';

export type ThemeProfileIds = {
  readonly colorScheme: ColorSchemeId;
  readonly density: DensityId;
  readonly typography: TypographyId;
};

export type ThemeClassNames = readonly [colorScheme: string, density: string, typography: string];

/**
 * A complete visual configuration resolved through the public profile
 * manifests. Consumers apply all three classes as one controlled unit.
 */
export type Theme = {
  readonly colorScheme: ColorSchemeManifestEntry;
  readonly density: DensityManifestEntry;
  readonly typography: TypographyManifestEntry;
  readonly classNames: ThemeClassNames;
};

export type ThemePrepaintClassEntry<Id extends string = string> = {
  readonly id: Id;
  readonly className: string;
};

export type ThemePrepaintColorSchemeEntry<Id extends string = string> =
  ThemePrepaintClassEntry<Id> & {
    readonly polarity: ColorSchemeManifestEntry['polarity'];
  };

function classNameFromSelector(selector: string): string {
  if (!/^\.[A-Za-z_][A-Za-z0-9_-]*$/.test(selector)) {
    throw new TypeError(`Theme profile selector must be one class selector: "${selector}"`);
  }
  return selector.slice(1);
}

function prepaintEntries<const Entries extends readonly { id: string; selector: string }[]>(
  entries: Entries
): readonly ThemePrepaintClassEntry<Entries[number]['id']>[] {
  return entries.map(({ id, selector }) => ({
    id,
    className: classNameFromSelector(selector),
  }));
}

/**
 * Serializable class lookup data for host pre-paint preparation.
 *
 * It is derived from the same public manifests used by {@link resolveTheme};
 * hosts can embed this data without importing CSS or the React runtime.
 */
export const THEME_PREPAINT_CLASS_DATA = {
  colorSchemes: COLOR_SCHEME_MANIFEST.map(({ id, polarity, selector }) => ({
    id,
    polarity,
    className: classNameFromSelector(selector),
  })) satisfies readonly ThemePrepaintColorSchemeEntry<ColorSchemeId>[],
  densities: prepaintEntries(DENSITY_MANIFEST),
  typographies: prepaintEntries(TYPOGRAPHY_MANIFEST),
} as const;

function resolveProfile<
  Id extends string,
  Entry extends { readonly id: string },
  Dimension extends keyof ThemeProfileIds,
>(dimension: Dimension, id: Id, manifest: readonly Entry[]): Entry {
  const entry = manifest.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new RangeError(`Unknown ${dimension} profile id "${id}"`);
  }
  return entry;
}

function resolveClassName<Id extends string>(
  id: Id,
  entries: readonly ThemePrepaintClassEntry<Id>[]
): string {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new RangeError(`Missing pre-paint class data for profile id "${id}"`);
  }
  return entry.className;
}

/**
 * Resolves one valid profile from every Theme dimension.
 *
 * @example
 * ```ts
 * import { resolveTheme } from '@emdash/theme/runtime';
 *
 * const theme = resolveTheme({
 *   colorScheme: 'dark',
 *   density: 'comfortable',
 *   typography: 'default',
 * });
 * ```
 */
export function resolveTheme(profileIds: ThemeProfileIds): Theme {
  const colorScheme = resolveProfile('colorScheme', profileIds.colorScheme, COLOR_SCHEME_MANIFEST);
  const density = resolveProfile('density', profileIds.density, DENSITY_MANIFEST);
  const typography = resolveProfile('typography', profileIds.typography, TYPOGRAPHY_MANIFEST);

  return {
    colorScheme,
    density,
    typography,
    classNames: [
      resolveClassName(profileIds.colorScheme, THEME_PREPAINT_CLASS_DATA.colorSchemes),
      resolveClassName(profileIds.density, THEME_PREPAINT_CLASS_DATA.densities),
      resolveClassName(profileIds.typography, THEME_PREPAINT_CLASS_DATA.typographies),
    ],
  };
}
