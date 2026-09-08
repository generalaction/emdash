import { tokens } from '@emdash/theme';
import { defineIntegrationManifest, type IntegrationValues } from '@emdash/ui/styles/host';

/**
 * Private Host Styling Adapter contract for Xterm's imperative Theme API.
 *
 * The field names are Xterm Theme properties. The manifest generates the
 * private CSS properties, host-layer writer, and computed-style reader from
 * this one map.
 */
export const xtermThemeIntegration = defineIntegrationManifest('xterm', {
  background: tokens.surface.role.paper.background,
  foreground: tokens.foreground.default,
  cursor: tokens.foreground.default,
  cursorAccent: tokens.foreground.inverse,
  selectionBackground: tokens.selection.background,
  selectionForeground: tokens.selection.foreground,
});

export type XtermThemeIntegrationValues = IntegrationValues<typeof xtermThemeIntegration>;
