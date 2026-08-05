import { describe, expect, it } from 'vitest';
import { DEFAULT_EDITOR_OPTIONS } from '@renderer/lib/editor/utils';
import { DIFF_EDITOR_BASE_OPTIONS } from '@renderer/lib/monaco/editorConfig';
import { DEFAULT_MONOSPACE_FONT_FAMILY } from '@renderer/lib/monospace-font';

describe('DIFF_EDITOR_BASE_OPTIONS', () => {
  it('keeps unchanged diff regions visible for large text selection', () => {
    expect(DIFF_EDITOR_BASE_OPTIONS.hideUnchangedRegions?.enabled).toBe(false);
  });

  it('renders +/- gutter indicators for added and removed lines', () => {
    expect(DIFF_EDITOR_BASE_OPTIONS.renderIndicators).toBe(true);
  });

  it('uses the shared modern monospace stack for file and diff editors', () => {
    expect(DEFAULT_EDITOR_OPTIONS.fontFamily).toBe(DEFAULT_MONOSPACE_FONT_FAMILY);
    expect(DIFF_EDITOR_BASE_OPTIONS.fontFamily).toBe(DEFAULT_MONOSPACE_FONT_FAMILY);
  });
});
