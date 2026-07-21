import React, { useEffect, useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Textarea } from '@renderer/lib/ui/textarea';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const IndexerSettingsCard: React.FC = () => {
  const {
    value,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('indexer');

  const segmentsKey = (value?.additionalExcludedSegments ?? []).join('\n');
  const [text, setText] = useState(segmentsKey);

  useEffect(() => {
    setText(segmentsKey);
  }, [segmentsKey]);

  const commit = () => {
    const parsed = Array.from(
      new Set(
        text
          .split('\n')
          .map((line) => line.trim())
          // Segments are matched per path component, so a value containing a
          // separator would never match; drop them so the field self-heals
          // instead of tripping the schema's refine on save.
          .filter((line) => line.length > 0 && !line.includes('/') && !line.includes('\\'))
      )
    );
    update({ additionalExcludedSegments: parsed });
  };

  return (
    <div className="flex flex-col gap-2">
      <SettingRow
        title="Extra excluded folders"
        description="Folder names to skip when indexing files for search and @-mentions, in addition to the built-in list and your .gitignore. One name per line."
        control={
          <ResetToDefaultButton
            visible={isFieldOverridden('additionalExcludedSegments')}
            defaultLabel="none"
            onReset={() => resetField('additionalExcludedSegments')}
            disabled={loading || saving}
          />
        }
      />
      <Textarea
        className="min-h-24 font-mono text-sm"
        value={text}
        disabled={loading || saving}
        placeholder={'.tox\n.mypy_cache'}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
      />
    </div>
  );
};

export default IndexerSettingsCard;
