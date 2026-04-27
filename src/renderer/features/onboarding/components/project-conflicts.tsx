import { Check } from 'lucide-react';
import { type LegacyImportSource, type LegacyProjectConflict } from '@shared/legacy-port';
import { cn } from '@renderer/utils/utils';
import { formatCount, sourceLabel } from './import-format';

function ConflictChoice({
  source,
  conflict,
  selected,
  disabled,
  onSelect,
}: {
  source: LegacyImportSource;
  conflict: LegacyProjectConflict;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const details = source === 'v0' ? conflict.v0 : conflict.v1Beta;

  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex min-w-0 flex-1 flex-col gap-1 border p-2.5 text-left',
        selected ? 'border-primary bg-background' : 'border-border bg-background-1',
        disabled && 'cursor-not-allowed opacity-60'
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">
          {sourceLabel(source)} · {formatCount(details.taskCount, 'task')}
        </span>
        {selected && <Check className="h-4 w-4 shrink-0" />}
      </span>
      <span className="truncate text-xs text-foreground-muted" title={details.path}>
        {details.path}
      </span>
    </button>
  );
}

function ConflictCard({
  conflict,
  selectedSource,
  disabled,
  onSelect,
}: {
  conflict: LegacyProjectConflict;
  selectedSource: LegacyImportSource;
  disabled: boolean;
  onSelect: (source: LegacyImportSource) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border p-2.5">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="truncate text-sm font-medium">{conflict.v1Beta.name}</span>
        <span className="shrink-0 text-xs text-foreground-muted">
          {conflict.kind === 'ssh' ? 'SSH' : 'Local'}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ConflictChoice
          source="v0"
          conflict={conflict}
          selected={selectedSource === 'v0'}
          disabled={disabled}
          onSelect={() => onSelect('v0')}
        />
        <ConflictChoice
          source="v1-beta"
          conflict={conflict}
          selected={selectedSource === 'v1-beta'}
          disabled={disabled}
          onSelect={() => onSelect('v1-beta')}
        />
      </div>
    </div>
  );
}

export function ProjectConflicts({
  conflicts,
  choices,
  disabled = false,
  onChoiceChange,
}: {
  conflicts: LegacyProjectConflict[];
  choices: Record<string, LegacyImportSource>;
  disabled?: boolean;
  onChoiceChange: (identityKey: string, source: LegacyImportSource) => void;
}) {
  if (conflicts.length === 0) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex shrink-0 flex-col gap-1">
        <h2 className="text-base font-medium">Project conflicts</h2>
        <p className="text-sm text-foreground-muted">
          These projects exist in both selected versions. Choose which version to keep.
        </p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {conflicts.map((conflict) => (
          <ConflictCard
            key={conflict.identityKey}
            conflict={conflict}
            selectedSource={choices[conflict.identityKey] ?? 'v1-beta'}
            disabled={disabled}
            onSelect={(source) => onChoiceChange(conflict.identityKey, source)}
          />
        ))}
      </div>
    </div>
  );
}
