import { describe, expect, it, vi } from 'vitest';
import {
  buildEditorFontOptions,
  updateCodeEditorFontOptions,
  updateDiffEditorFontOptions,
} from '@renderer/lib/monaco/editor-font-settings';
import { DIFF_EDITOR_BASE_OPTIONS } from '@renderer/lib/monaco/editorConfig';
import { EDITOR_FONT_SIZE_DEFAULT } from '@shared/core/editor/editor-settings';

describe('DIFF_EDITOR_BASE_OPTIONS', () => {
  it('keeps unchanged diff regions visible for large text selection', () => {
    expect(DIFF_EDITOR_BASE_OPTIONS.hideUnchangedRegions?.enabled).toBe(false);
  });

  it('renders +/- gutter indicators for added and removed lines', () => {
    expect(DIFF_EDITOR_BASE_OPTIONS.renderIndicators).toBe(true);
  });
});

describe('editor font options', () => {
  const monacoDefaults = {
    fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  };

  it('preserves Monaco font defaults when no preference is configured', () => {
    expect(buildEditorFontOptions(undefined, monacoDefaults)).toEqual({
      fontFamily: monacoDefaults.fontFamily,
      fontSize: EDITOR_FONT_SIZE_DEFAULT,
    });
  });

  it('updates an open code editor with the configured family and size', () => {
    const target = { updateOptions: vi.fn() };

    updateCodeEditorFontOptions(
      target,
      { fontFamily: 'JetBrains Mono', fontSize: 16 },
      monacoDefaults
    );

    expect(target.updateOptions).toHaveBeenCalledWith({
      fontFamily: 'JetBrains Mono',
      fontSize: 16,
    });
  });

  it('updates an open diff editor and lets Monaco scale custom line heights', () => {
    const target = { updateOptions: vi.fn() };

    updateDiffEditorFontOptions(
      target,
      { fontFamily: 'Fira Code', fontSize: 18 },
      { ...monacoDefaults, lineHeight: 20 }
    );

    expect(target.updateOptions).toHaveBeenCalledWith({
      fontFamily: 'Fira Code',
      fontSize: 18,
      lineHeight: 0,
    });
  });

  it('restores the captured Monaco family and diff spacing when reset', () => {
    expect(
      buildEditorFontOptions(
        { fontSize: EDITOR_FONT_SIZE_DEFAULT },
        { ...monacoDefaults, lineHeight: 20 }
      )
    ).toEqual({
      fontFamily: monacoDefaults.fontFamily,
      fontSize: EDITOR_FONT_SIZE_DEFAULT,
      lineHeight: 20,
    });
  });
});
