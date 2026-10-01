import { describe, expect, it, vi } from 'vitest';
import {
  buildEditorFontOptions,
  updateCodeEditorFontOptions,
  updateDiffEditorFontOptions,
} from '@core/features/editor/browser/monaco/editor-font-settings';
import { DIFF_EDITOR_BASE_OPTIONS } from '@core/features/editor/browser/monaco/editorConfig';
import {
  EDITOR_FONT_SIZE_DEFAULT,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
} from '@core/primitives/app-settings/api';

describe('DIFF_EDITOR_BASE_OPTIONS', () => {
  it('keeps unchanged diff regions visible for large text selection', () => {
    expect(DIFF_EDITOR_BASE_OPTIONS.hideUnchangedRegions?.enabled).toBe(false);
  });

  it('renders +/- gutter indicators for added and removed lines', () => {
    expect(DIFF_EDITOR_BASE_OPTIONS.renderIndicators).toBe(true);
  });

  it('uses the shared editor font-size default', () => {
    expect(DIFF_EDITOR_BASE_OPTIONS.fontSize).toBe(EDITOR_FONT_SIZE_DEFAULT);
  });
});

describe('editor font options', () => {
  const monacoDefaults = {
    fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  };

  it('preserves Monaco defaults when no preference is configured', () => {
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
      fontFamily: `"JetBrains Mono", "Menlo", "Monaco", 'Courier New', monospace`,
      fontSize: 16,
    });
  });

  it('quotes custom family names and keeps the Monaco stack as a fallback', () => {
    expect(
      buildEditorFontOptions({ fontFamily: '3270 Nerd Font', fontSize: 13 }, monacoDefaults)
        .fontFamily
    ).toBe(`"3270 Nerd Font", "Menlo", "Monaco", 'Courier New', monospace`);
    expect(
      buildEditorFontOptions({ fontFamily: 'SF Mono, monospace', fontSize: 13 }, monacoDefaults)
        .fontFamily
    ).toBe(`"SF Mono", monospace, "Menlo", "Monaco", 'Courier New'`);
  });

  it('updates an open diff editor and scales its line height with the font size', () => {
    const target = { updateOptions: vi.fn() };

    updateDiffEditorFontOptions(
      target,
      { fontFamily: 'Fira Code', fontSize: 18 },
      { ...monacoDefaults, lineHeight: 20 }
    );

    expect(target.updateOptions).toHaveBeenCalledWith({
      fontFamily: `"Fira Code", "Menlo", "Monaco", 'Courier New', monospace`,
      fontSize: 18,
      lineHeight: 28,
    });
  });

  it('never shrinks diff line height when the font size grows', () => {
    const diffDefaults = { ...monacoDefaults, lineHeight: 20 };
    let previous = 0;
    for (let fontSize = EDITOR_FONT_SIZE_MIN; fontSize <= EDITOR_FONT_SIZE_MAX; fontSize++) {
      const { lineHeight = 0 } = buildEditorFontOptions({ fontSize }, diffDefaults);
      expect(lineHeight).toBeGreaterThan(previous);
      expect(lineHeight).toBeGreaterThanOrEqual(Math.ceil(fontSize * 1.5));
      previous = lineHeight;
    }
  });

  it('restores the captured Monaco family and diff spacing at the default size', () => {
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
