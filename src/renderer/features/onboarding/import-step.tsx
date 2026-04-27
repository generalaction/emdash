import { useMemo, useState } from 'react';
import type { LegacyImportSource } from '@shared/legacy-port';
import { useImportProgress } from '@renderer/lib/hooks/useImportProgress';
import {
  useLegacyPortImport,
  useLegacyPortPreview,
  useLegacyPortStartFresh,
} from '@renderer/lib/hooks/useLegacyPort';
import { Button } from '@renderer/lib/ui/button';
import { ImportHeader } from './components/import-header';
import { ImportProgress } from './components/import-progress';
import { ImportSourceSelector } from './components/import-source-selector';
import { ProjectConflicts } from './components/project-conflicts';

function availableSources(preview: ReturnType<typeof useLegacyPortPreview>['data']) {
  const sources: LegacyImportSource[] = [];
  if (preview?.sources.v0.available) sources.push('v0');
  if (preview?.sources.v1Beta.available) sources.push('v1-beta');
  return sources;
}

function toggleSourceSelection(
  sources: LegacyImportSource[],
  source: LegacyImportSource
): LegacyImportSource[] {
  if (sources.includes(source)) {
    return sources.filter((candidate) => candidate !== source);
  }
  return [...sources, source];
}

export function ImportStep({ onComplete }: { onComplete: () => void }) {
  const { data: preview, isLoading: previewLoading } = useLegacyPortPreview(true);
  const importMutation = useLegacyPortImport();
  const startFreshMutation = useLegacyPortStartFresh();
  const importProgress = useImportProgress();

  const sourceOptions = useMemo(() => availableSources(preview), [preview]);
  const [selectedSourcesOverride, setSelectedSourcesOverride] = useState<
    LegacyImportSource[] | null
  >(null);
  const [conflictChoiceOverrides, setConflictChoiceOverrides] = useState<
    Record<string, LegacyImportSource>
  >({});
  const [startFreshError, setStartFreshError] = useState<string | null>(null);

  const selectedSources = selectedSourcesOverride ?? sourceOptions;
  const visibleConflicts = useMemo(() => {
    if (!selectedSources.includes('v0') || !selectedSources.includes('v1-beta')) return [];
    return preview?.conflicts ?? [];
  }, [preview?.conflicts, selectedSources]);

  const v0Preview = preview?.sources.v0 ?? { available: false, projects: 0, tasks: 0 };
  const betaPreview = preview?.sources.v1Beta ?? { available: false, projects: 0, tasks: 0 };
  const canImport = selectedSources.length > 0 && !previewLoading;

  const toggleSource = (source: LegacyImportSource) => {
    setSelectedSourcesOverride((current) =>
      toggleSourceSelection(current ?? selectedSources, source)
    );
  };

  const updateConflictChoice = (identityKey: string, source: LegacyImportSource) => {
    setConflictChoiceOverrides((current) => ({
      ...current,
      [identityKey]: source,
    }));
  };

  const handleImport = async () => {
    setStartFreshError(null);
    const conflictChoices = Object.fromEntries(
      visibleConflicts.map((conflict) => [
        conflict.identityKey,
        conflictChoiceOverrides[conflict.identityKey] ?? 'v1-beta',
      ])
    ) as Record<string, LegacyImportSource>;

    await importProgress.run(
      () =>
        importMutation.mutateAsync({
          sources: selectedSources,
          conflictChoices,
        }),
      { onComplete }
    );
  };

  const handleStartFresh = async () => {
    setStartFreshError(null);
    importProgress.clearError();
    try {
      const result = await startFreshMutation.mutateAsync();
      if (!result.success) {
        setStartFreshError(result.error ?? 'Start fresh failed');
        return;
      }
      onComplete();
    } catch (err) {
      setStartFreshError(err instanceof Error ? err.message : 'Start fresh failed');
    }
  };

  const isBusy = importProgress.isImporting || startFreshMutation.isPending;

  return (
    <div className="flex h-full min-h-0 w-full max-w-3xl flex-col gap-5 overflow-hidden p-6">
      <ImportHeader isLoading={previewLoading} />

      {!previewLoading && (
        <ImportSourceSelector
          sources={sourceOptions}
          v0Preview={v0Preview}
          betaPreview={betaPreview}
          selectedSources={selectedSources}
          onToggle={toggleSource}
        />
      )}

      <ProjectConflicts
        conflicts={visibleConflicts}
        choices={conflictChoiceOverrides}
        onChoiceChange={updateConflictChoice}
      />

      {importProgress.isImporting && <ImportProgress progress={importProgress.progress} />}

      {importProgress.error && (
        <p className="text-sm text-destructive text-center">{importProgress.error}</p>
      )}
      {startFreshError && <p className="text-sm text-destructive text-center">{startFreshError}</p>}

      <div className="flex w-full shrink-0 flex-col gap-2">
        <Button size={'lg'} onClick={handleImport} disabled={isBusy || !canImport}>
          {importProgress.isImporting ? 'Importing...' : 'Import data'}
        </Button>
        <Button variant="ghost" onClick={handleStartFresh} disabled={isBusy}>
          Start fresh
        </Button>
      </div>
    </div>
  );
}
