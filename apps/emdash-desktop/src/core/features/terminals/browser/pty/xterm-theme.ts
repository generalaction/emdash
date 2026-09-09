import { cssColorToHex } from '@core/primitives/styling/browser/cssVars';
import { xtermThemeIntegration, type XtermThemeIntegrationValues } from './xterm-theme-integration';

type XtermThemeStyle = Parameters<typeof xtermThemeIntegration.read>[0];

/**
 * Reads Xterm's complete imperative Theme from its generated integration
 * contract. Private CSS property names remain owned by the manifest.
 */
export function readXtermTheme(
  style: XtermThemeStyle = getComputedStyle(document.documentElement)
): XtermThemeIntegrationValues {
  return Object.fromEntries(
    Object.entries(xtermThemeIntegration.read(style)).map(([field, value]) => [
      field,
      cssColorToHex(value),
    ])
  ) as XtermThemeIntegrationValues;
}
