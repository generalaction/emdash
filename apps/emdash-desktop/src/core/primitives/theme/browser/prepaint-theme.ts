import {
  THEME_PREPAINT_CLASS_DATA,
  type ThemeClassNames,
  type ThemePrepaintClassEntry,
  type ThemeProfileIds,
} from '@emdash/theme/runtime';

/** Serializable public profile data shared with the active host bootstrap. */
export const PREPAINT_THEME_CLASS_DATA = THEME_PREPAINT_CLASS_DATA;

function resolvePrepaintClass(
  dimension: keyof ThemeProfileIds,
  id: string,
  entries: readonly ThemePrepaintClassEntry[]
): string {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new RangeError(`Unknown ${dimension} profile id "${id}"`);
  }
  return entry.className;
}

/**
 * Resolves the classes a host bootstrap can apply before CSS and React load.
 */
export function resolvePrepaintThemeClasses(profileIds: ThemeProfileIds): ThemeClassNames {
  return [
    resolvePrepaintClass(
      'colorScheme',
      profileIds.colorScheme,
      PREPAINT_THEME_CLASS_DATA.colorSchemes
    ),
    resolvePrepaintClass('density', profileIds.density, PREPAINT_THEME_CLASS_DATA.densities),
    resolvePrepaintClass(
      'typography',
      profileIds.typography,
      PREPAINT_THEME_CLASS_DATA.typographies
    ),
  ];
}
