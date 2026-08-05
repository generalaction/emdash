import { useCallback } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  EDITOR_FONT_SIZE_DEFAULT,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
} from '@shared/core/editor/editor-settings';
import { FontFamilySettingRow, FontSizeSettingRow } from './FontSettingsRows';

export function EditorSettingsCard() {
  const { value: editor, update, isLoading, isSaving } = useAppSettingsKey('editor');

  const fontFamily = editor?.fontFamily ?? '';
  const fontSize = editor?.fontSize ?? EDITOR_FONT_SIZE_DEFAULT;

  const applyFontFamily = useCallback(
    (next: string) => {
      update({ fontFamily: next.trim() || undefined });
    },
    [update]
  );

  const applyFontSize = useCallback(
    (next: number) => {
      update({
        fontSize: Math.min(EDITOR_FONT_SIZE_MAX, Math.max(EDITOR_FONT_SIZE_MIN, next)),
      });
    },
    [update]
  );

  return (
    <div className="flex flex-col gap-4">
      <FontFamilySettingRow
        title="File preview font"
        description="Choose the font family used for text files and diffs."
        value={fontFamily}
        defaultLabel="Default (Monaco editor)"
        defaultPreviewFontFamily="monospace"
        disabled={isLoading || isSaving}
        onChange={applyFontFamily}
      />
      <FontSizeSettingRow
        title="File preview font size"
        description="Adjust the font size used for text files and diffs."
        value={fontSize}
        min={EDITOR_FONT_SIZE_MIN}
        max={EDITOR_FONT_SIZE_MAX}
        controlLabel="file preview font size"
        disabled={isLoading || isSaving}
        onChange={applyFontSize}
      />
    </div>
  );
}
