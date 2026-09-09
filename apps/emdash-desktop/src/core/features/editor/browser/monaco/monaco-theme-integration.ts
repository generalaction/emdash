import { tokens } from '@emdash/theme';
import { defineIntegrationManifest, type IntegrationValues } from '@emdash/ui/styles/host';

/**
 * Private Host Styling Adapter contract for Monaco's imperative color API.
 *
 * The field names are Monaco color ids. The manifest generates the private CSS
 * properties, host-layer writer, and computed-style reader from this one map.
 */
export const monacoThemeIntegration = defineIntegrationManifest('monaco', {
  'editor.background': tokens.surface.role.paper.background,
  'editor.foreground': tokens.foreground.default,
  'editor.lineHighlightBackground': tokens.surface.role.paper.hover,
  'editorLineNumber.foreground': tokens.foreground.passive,
  'editorGutter.background': tokens.surface.role.paper.background,
  'diffEditor.insertedTextBackground': tokens.palette.green.step4,
  'diffEditor.insertedLineBackground': tokens.palette.green.step3,
  'diffEditor.insertedTextBorder': tokens.palette.green.step7,
  'diffEditor.removedTextBackground': tokens.palette.red.step4,
  'diffEditor.removedLineBackground': tokens.palette.red.step3,
  'diffEditor.removedTextBorder': tokens.palette.red.step7,
  'diffEditor.unchangedRegionBackground': tokens.palette.neutral.step3,
  'diffEditor.border': tokens.palette.neutral.step6,
  'diffEditor.diagonalFill': tokens.palette.neutral.step4,
  'editor.selectionBackground': tokens.selection.background,
  'editor.selectionForeground': tokens.selection.foreground,
  'editor.inactiveSelectionBackground': tokens.palette.accent.step4,
});

export type MonacoThemeIntegrationValues = IntegrationValues<typeof monacoThemeIntegration>;
