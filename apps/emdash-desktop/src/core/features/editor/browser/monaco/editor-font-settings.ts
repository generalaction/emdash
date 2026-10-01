import type { editor } from 'monaco-editor';
import {
  buildFontFamilyList,
  splitFontFamilies,
} from '@core/features/terminals/api/browser/pty/terminal-font';
import { EDITOR_FONT_SIZE_DEFAULT, type EditorSettings } from '@core/primitives/app-settings/api';

export type EditorFontDefaults = {
  fontFamily: string;
  lineHeight?: number;
};

export type EditorFontOptions = {
  fontFamily: string;
  fontSize: number;
  lineHeight?: number;
};

export function buildEditorFontOptions(
  settings: EditorSettings | undefined,
  defaults: EditorFontDefaults
): EditorFontOptions {
  const fontSize = settings?.fontSize ?? EDITOR_FONT_SIZE_DEFAULT;
  const configuredFontFamily = settings?.fontFamily?.trim();
  const options: EditorFontOptions = {
    // The picker stores one family name, which may itself contain a comma, so
    // keep it atomic. Fall back to Monaco's own stack so a missing font never
    // drops to a proportional browser default.
    fontFamily: configuredFontFamily
      ? buildFontFamilyList([configuredFontFamily, ...splitFontFamilies(defaults.fontFamily)])
      : defaults.fontFamily,
    fontSize,
  };

  if (defaults.lineHeight !== undefined) {
    // Scale the fixed diff line height with the font size so the default size
    // keeps its existing spacing and larger sizes are never clipped.
    options.lineHeight = Math.round((defaults.lineHeight * fontSize) / EDITOR_FONT_SIZE_DEFAULT);
  }

  return options;
}

export function updateCodeEditorFontOptions(
  target: Pick<editor.IStandaloneCodeEditor, 'updateOptions'>,
  settings: EditorSettings | undefined,
  defaults: EditorFontDefaults
): void {
  target.updateOptions(buildEditorFontOptions(settings, defaults));
}

export function updateDiffEditorFontOptions(
  target: Pick<editor.IStandaloneDiffEditor, 'updateOptions'>,
  settings: EditorSettings | undefined,
  defaults: EditorFontDefaults
): void {
  target.updateOptions(buildEditorFontOptions(settings, defaults));
}
