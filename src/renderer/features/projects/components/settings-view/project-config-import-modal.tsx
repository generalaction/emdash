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
import { Field, FieldGroup, FieldTitle } from '@renderer/lib/ui/field';
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

function sourceLabel(migration: ProjectConfigMigration | undefined): string {
  if (!migration) return 'No config selected';
  return `${migration.label} (${filesLabel(migration.files)})`;
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

  const disabled = !selectedMigration || status === 'importing';

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
          <Field>
            {migrations.length > 1 ? (
              <Select
                value={selectedMigration?.provider ?? ''}
                onValueChange={(value) =>
                  setSelectedProvider(value as ProjectConfigMigrationProvider)
                }
              >
                <SelectTrigger className="w-full min-w-0">
                  <span className="min-w-0 truncate">{sourceLabel(selectedMigration)}</span>
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false} sideOffset={6}>
                  {migrations.map((migration) => (
                    <SelectItem key={migration.provider} value={migration.provider}>
                      {sourceLabel(migration)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-foreground-muted">
                Found {sourceLabel(selectedMigration)}.
              </p>
            )}
          </Field>

          <div className="grid gap-4 rounded-md border border-border bg-background-secondary/40 p-3">
            <div className="space-y-2">
              <FieldTitle>Will import</FieldTitle>
              <div className="flex flex-wrap gap-2">
                {selectedMigration?.fields.map((field) => (
                  <span
                    key={field}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                  >
                    {fieldLabel(field)}
                  </span>
                ))}
              </div>
            </div>

            {selectedMigration?.unsupportedFields.length ? (
              <div className="space-y-2">
                <FieldTitle>Will skip</FieldTitle>
                <div className="flex flex-wrap gap-2">
                  {selectedMigration.unsupportedFields.map((field) => (
                    <span
                      key={field}
                      className="rounded-md border border-border px-2 py-1 text-xs text-foreground-muted"
                    >
                      {field}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <Field>
            <FieldTitle>Save imported settings</FieldTitle>
            <RadioGroup
              value={destination}
              onValueChange={(value) => setDestination(value as ProjectConfigMigrationDestination)}
              className="grid gap-2"
            >
              <label className="flex items-start gap-3 rounded-md border border-border px-3 py-2 text-sm">
                <RadioGroupItem value="local" className="mt-0.5" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span>Local project settings</span>
                  <span className="text-xs text-foreground-muted">
                    Only apply them on this device.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-md border border-border px-3 py-2 text-sm">
                <RadioGroupItem value="shared" className="mt-0.5" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span>.emdash.json</span>
                  <span className="text-xs text-foreground-muted">
                    Commit the file to share them with your team.
                  </span>
                </span>
              </label>
            </RadioGroup>
          </Field>
          {status === 'error' ? <p className="text-xs text-red-500">{errorMessage}</p> : null}
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={status === 'importing'}>
          Cancel
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
