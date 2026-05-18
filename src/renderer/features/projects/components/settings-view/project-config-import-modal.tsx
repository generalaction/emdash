import { Check, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  MigrateProjectConfigRequest,
  MigrateProjectConfigResult,
  ProjectConfigMigration,
  ProjectConfigMigrationDestination,
  ProjectConfigMigrationProvider,
} from '@shared/project-settings';
import type { UpdateProjectSettingsError } from '@shared/projects';
import { err, type Result } from '@shared/result';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup } from '@renderer/lib/ui/field';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/lib/ui/select';
import { SHAREABLE_FIELD_DESCRIPTOR_BY_ID } from './shareable-project-settings-fields';

type ImportStatus = 'idle' | 'importing' | 'imported' | 'error';

export type ProjectConfigImportModalArgs = {
  migrations: ProjectConfigMigration[];
  migrateProjectConfig: (
    request: MigrateProjectConfigRequest
  ) => Promise<Result<MigrateProjectConfigResult, UpdateProjectSettingsError>>;
};

type Props = BaseModalProps<MigrateProjectConfigResult> & ProjectConfigImportModalArgs;

function unknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fieldLabel(field: ProjectConfigMigration['fields'][number]): string {
  return SHAREABLE_FIELD_DESCRIPTOR_BY_ID[field].modalLabel;
}

function filesLabel(files: string[]): string {
  return files.length === 1 ? files[0] : files.join(', ');
}

export function ProjectConfigImportModal({
  migrations,
  migrateProjectConfig,
  onSuccess,
  onClose,
}: Props) {
  const [selectedProvider, setSelectedProvider] = useState<ProjectConfigMigrationProvider>(
    migrations[0]?.provider ?? 'conductor'
  );
  const [destination, setDestination] = useState<ProjectConfigMigrationDestination>('local');
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedMigration = useMemo(
    () => migrations.find((migration) => migration.provider === selectedProvider) ?? migrations[0],
    [migrations, selectedProvider]
  );
  const description =
    migrations.length === 1 && selectedMigration
      ? `Found configuration file from ${selectedMigration.label} that can be imported into Emdash.`
      : 'Found configuration files that can be imported into Emdash.';

  const disabled = !selectedMigration || status === 'importing' || status === 'imported';

  async function handleImport() {
    if (!selectedMigration) return;

    setStatus('importing');
    setErrorMessage(null);
    const result = await migrateProjectConfig({
      provider: selectedMigration.provider,
      destination,
    }).catch((error) =>
      err({
        type: 'write-config-failed' as const,
        message: unknownErrorMessage(error),
      })
    );

    if (result.success) {
      setStatus('imported');
      onSuccess(result.data);
      return;
    }

    setErrorMessage(
      result.error.type === 'write-config-failed'
        ? result.error.message
        : 'Failed to import project config.'
    );
    setStatus('error');
  }

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>Import project config</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          <p className="text-sm text-foreground-muted">{description}</p>
          {migrations.length > 1 && (
            <Field>
              <Select
                value={selectedMigration?.provider ?? ''}
                onValueChange={(value) =>
                  setSelectedProvider(value as ProjectConfigMigrationProvider)
                }
              >
                <SelectTrigger className="w-full min-w-0">
                  <span className="min-w-0 truncate">
                    {selectedMigration?.label ?? 'Select config'}
                  </span>
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false} sideOffset={6}>
                  {migrations.map((migration) => (
                    <SelectItem key={migration.provider} value={migration.provider}>
                      {migration.label} ({filesLabel(migration.files)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {selectedMigration ? (
            <div className="space-y-2 text-sm">
              <p>Settings to import</p>
              <ul className="list-disc space-y-1 pl-5 text-foreground-muted">
                {selectedMigration.fields.map((field) => (
                  <li key={field}>{fieldLabel(field)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-2 text-sm">
            <p>Save to</p>
            <RadioGroup
              value={destination}
              onValueChange={(value) => setDestination(value as ProjectConfigMigrationDestination)}
              className="grid"
            >
              <label className="flex items-center gap-3 rounded-md text-sm">
                <RadioGroupItem value="local" className="translate-y-px" />
                <span className="flex min-w-0 flex-row gap-1.5">
                  <p>Settings</p>
                  <p className="text-foreground-muted">– local to this machine</p>
                </span>
              </label>
              <label className="flex items-center gap-3 rounded-md text-sm">
                <RadioGroupItem value="shared" className="translate-y-px" />
                <span className="flex min-w-0 flex-row gap-1.5">
                  <p>.emdash.json</p>
                  <p className="text-foreground-muted">– commit to share with team</p>
                </span>
              </label>
            </RadioGroup>
          </div>
          {status === 'error' ? <p className="text-xs text-foreground-error">{errorMessage}</p> : null}
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={status === 'importing'}>
          {status === 'imported' ? 'Close' : 'Cancel'}
        </Button>
        <ConfirmButton onClick={() => void handleImport()} disabled={disabled}>
          <span className="inline-flex items-center justify-center gap-1.5">
            {status === 'importing' && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {status === 'imported' && <Check className="size-4" aria-hidden />}
            {status === 'importing'
              ? 'Importing...'
              : status === 'imported'
                ? 'Imported'
                : 'Import'}
          </span>
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}
