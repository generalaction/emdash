import { Check } from 'lucide-react';
import { type LegacyImportSource, type LegacyPortPreviewSource } from '@shared/legacy-port';
import { cn } from '@renderer/utils/utils';
import { formatCount, sourceLabel } from './import-format';

function SourceCard({
  source,
  preview,
  selected,
  onToggle,
}: {
  source: LegacyImportSource;
  preview: LegacyPortPreviewSource;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cn(
        'flex min-h-24 flex-1 flex-col items-start justify-between border p-4 text-left transition-colors',
        selected
          ? 'border-primary bg-background text-foreground'
          : 'border-border bg-background-1 text-foreground hover:bg-background'
      )}
    >
      <span className="flex w-full items-center justify-between gap-3">
        <span className="text-base font-medium">{sourceLabel(source)}</span>
        <span
          className={cn(
            'flex h-5 w-5 items-center justify-center border',
            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
          )}
        >
          {selected && <Check className="h-3.5 w-3.5" />}
        </span>
      </span>
      <span className="text-sm text-foreground-muted">
        {formatCount(preview.projects, 'project')} · {formatCount(preview.tasks, 'task')}
      </span>
    </button>
  );
}

export function ImportSourceSelector({
  sources,
  v0Preview,
  betaPreview,
  selectedSources,
  onToggle,
}: {
  sources: LegacyImportSource[];
  v0Preview: LegacyPortPreviewSource;
  betaPreview: LegacyPortPreviewSource;
  selectedSources: LegacyImportSource[];
  onToggle: (source: LegacyImportSource) => void;
}) {
  if (sources.length === 0) return null;

  return (
    <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2">
      {sources.includes('v0') && (
        <SourceCard
          source="v0"
          preview={v0Preview}
          selected={selectedSources.includes('v0')}
          onToggle={() => onToggle('v0')}
        />
      )}
      {sources.includes('v1-beta') && (
        <SourceCard
          source="v1-beta"
          preview={betaPreview}
          selected={selectedSources.includes('v1-beta')}
          onToggle={() => onToggle('v1-beta')}
        />
      )}
    </div>
  );
}
