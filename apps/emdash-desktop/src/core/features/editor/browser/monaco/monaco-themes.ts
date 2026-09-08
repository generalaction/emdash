import { COLOR_SCHEME_MANIFEST, type ColorSchemeManifestEntry } from '@emdash/theme/profiles';
import type { Monaco } from '@monaco-editor/react';
import { cssColorToHex } from '@core/primitives/styling/browser/cssVars';
import {
  monacoThemeIntegration,
  type MonacoThemeIntegrationValues,
} from './monaco-theme-integration';

type MonacoThemeStyle = Parameters<typeof monacoThemeIntegration.read>[0];

/**
 * Reads Monaco's complete color map from its generated integration contract.
 * Private CSS property names remain owned by the manifest.
 */
export function readMonacoThemeColors(
  style: MonacoThemeStyle = getComputedStyle(document.documentElement)
): MonacoThemeIntegrationValues {
  return Object.fromEntries(
    Object.entries(monacoThemeIntegration.read(style)).map(([field, value]) => [
      field,
      cssColorToHex(value),
    ])
  ) as MonacoThemeIntegrationValues;
}

function resolveColorScheme(effectiveTheme: string): ColorSchemeManifestEntry {
  const colorScheme = COLOR_SCHEME_MANIFEST.find(
    (entry) => entry.selector === `.${effectiveTheme}`
  );
  if (!colorScheme) {
    throw new RangeError(`Unknown active Color scheme class "${effectiveTheme}"`);
  }
  return colorScheme;
}

function activeColorSchemeClass(): string {
  const colorScheme =
    COLOR_SCHEME_MANIFEST.find((entry) =>
      document.documentElement.classList.contains(entry.selector.slice(1))
    ) ?? COLOR_SCHEME_MANIFEST[0];
  if (!colorScheme) {
    throw new Error('Monaco requires at least one Color scheme profile');
  }
  return colorScheme.selector.slice(1);
}

/**
 * Defines the currently resolved Monaco Theme. Runtime changes re-read the
 * generated contract before activating the corresponding Monaco Theme id.
 */
export function defineMonacoThemes(
  monaco: Monaco,
  effectiveTheme = activeColorSchemeClass()
): void {
  const colorScheme = resolveColorScheme(effectiveTheme);
  monaco.editor.defineTheme(getMonacoTheme(effectiveTheme), {
    base: colorScheme.polarity === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: readMonacoThemeColors(),
  });
}

export function getMonacoTheme(effectiveTheme: string): string {
  return `custom-${resolveColorScheme(effectiveTheme).id}`;
}
