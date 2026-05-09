import { Import } from 'lucide-react';
import type { LegacyImportSource, LegacyPortPreviewSource } from '@shared/legacy-port';
import { formatCount, sourceLabel } from './import-format';

export type SingleSourceImport = {
  source: LegacyImportSource;
  preview: LegacyPortPreviewSource;
};

export type ImportHeaderProps = {
  isLoading: boolean;
  singleSource?: SingleSourceImport | null;
};

function singleSourceTitle(source: LegacyImportSource): string {
  return `Import your Emdash ${sourceLabel(source)} data`;
}

function singleSourceDescription(preview: LegacyPortPreviewSource): string {
  return `Found ${formatCount(preview.projects, 'project')} and ${formatCount(
    preview.tasks,
    'task'
  )} from your previous Emdash installation`;
}

export function ImportHeader({ isLoading, singleSource = null }: ImportHeaderProps) {
  const title = singleSource
    ? singleSourceTitle(singleSource.source)
    : 'Do you want to import projects and tasks from other Emdash versions?';
  const description = singleSource
    ? singleSourceDescription(singleSource.preview)
    : 'Select one or more sources.';

  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-4">
      <div className="flex flex-col items-center justify-center gap-5">
        <Import className="h-10 w-10" absoluteStrokeWidth strokeWidth={1.5} />
        <div className="flex flex-col items-center justify-center gap-2">
          <h1 className="text-xl text-center">{title}</h1>
          {isLoading ? (
            <p className="text-md text-foreground-muted text-center">
              Scanning existing Emdash data...
            </p>
          ) : (
            <p className="text-md text-foreground-muted text-center">{description}</p>
          )}
        </div>
      </div>
    </div>
  );
}
