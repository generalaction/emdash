import { Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldTitle } from '@renderer/lib/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/lib/ui/select';
import type {
  ProjectSettingsPage,
  ProjectSettingsWriteTarget,
  ProjectSettingsWriteTargetOption,
  ShareableProjectSettingsWriteField,
  WriteProjectConfigRequest,
} from '@shared/core/project-settings/project-settings';
import { err, type Result } from '@shared/lib/result';
import type { UpdateProjectSettingsError } from '@shared/projects';
import { SHAREABLE_FIELD_DESCRIPTOR_BY_ID } from './shareable-project-settings-fields';

type WriteStatus = 'idle' | 'writing' | 'written' | 'error';

export type ShareProjectConfigModalArgs = {
  availableFields: ShareableProjectSettingsWriteField[];
  defaultFields: ShareableProjectSettingsWriteField[];
  initialTarget: string;
  targets: ProjectSettingsWriteTargetOption[];
  writeConfigToRepo: (
    request: WriteProjectConfigRequest
  ) => Promise<Result<ProjectSettingsPage, UpdateProjectSettingsError>>;
};

type ShareProjectConfigModalResult = {
  fields: ShareableProjectSettingsWriteField[];
  page: ProjectSettingsPage;
};

type Props = BaseModalProps<ShareProjectConfigModalResult> & ShareProjectConfigModalArgs;

export function projectConfigTargetValue(target: ProjectSettingsWriteTargetOption): string {
  if (target.type === 'project') return 'project:repository';
  if (target.type === 'task') return `task:${target.taskId}`;
  return `workspace:${target.workspaceId}`;
}

function parseTargetValue(
  target: ProjectSettingsWriteTargetOption | null
): ProjectSettingsWriteTarget | null {
  if (!target) return null;
  if (target.type === 'project') return { type: 'project' };
  if (target.type === 'task') return { type: 'task', taskId: target.taskId };
  return { type: 'workspace', workspaceId: target.workspaceId };
}

export function projectConfigWriteFieldLabel(field: ShareableProjectSettingsWriteField): string {
  return SHAREABLE_FIELD_DESCRIPTOR_BY_ID[field].modalLabel;
}

function unknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ShareProjectConfigModal({
  availableFields,
  defaultFields,
  initialTarget,
  targets,
  writeConfigToRepo,
  onSuccess,
  onClose,
}: Props) {
  const firstTarget = targets[0] ?? null;
  const initialTargetOption = targets.find(
    (target) => projectConfigTargetValue(target) === initialTarget
  );
  const [selectedTarget, setSelectedTarget] = useState<ProjectSettingsWriteTargetOption | null>(
    initialTargetOption ?? firstTarget
  );
  const [selectedFields, setSelectedFields] =
    useState<ShareableProjectSettingsWriteField[]>(defaultFields);
  const [status, setStatus] = useState<WriteStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedTargetValue = selectedTarget ? projectConfigTargetValue(selectedTarget) : '';
  const selectedTargetLabel = selectedTarget?.label ?? 'Select a working copy';

  const disabled = status === 'writing' || selectedFields.length === 0 || !selectedTarget;

  function toggleField(field: ShareableProjectSettingsWriteField, checked: boolean) {
    setStatus((current) => (current === 'idle' ? current : 'idle'));
    setErrorMessage(null);
    setSelectedFields((current) =>
      checked ? [...current, field] : current.filter((candidate) => candidate !== field)
    );
  }

  async function handleWrite() {
    const target = parseTargetValue(selectedTarget);
    if (!target) return;

    setStatus('writing');
    setErrorMessage(null);
    const fields = selectedFields;
    const result = await writeConfigToRepo({
      target,
      fields,
    }).catch((error) =>
      err({
        type: 'write-config-failed' as const,
        message: unknownErrorMessage(error),
      })
    );

    if (result.success) {
      setStatus('written');
      onSuccess({ fields, page: result.data });
      return;
    }

    setErrorMessage(
      result.error.type === 'write-config-failed' ? result.error.message : 'Failed to write config.'
    );
    setStatus('error');
  }

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>Share settings with your team</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          <p className="text-sm text-foreground-muted">
            This writes the selected settings to .emdash.json in the chosen working directory.
            Commit that file so teammates get the same project defaults after pulling.
          </p>
          <Field>
            <FieldTitle>Write to</FieldTitle>
            <Select
              value={selectedTargetValue}
              onValueChange={(value) => {
                setSelectedTarget(
                  targets.find((target) => projectConfigTargetValue(target) === value) ?? null
                );
              }}
            >
              <SelectTrigger className="w-full min-w-0">
                <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="min-w-0 truncate">{selectedTargetLabel}</span>
                </div>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false} sideOffset={6}>
                {targets.map((target) => (
                  <SelectItem
                    key={projectConfigTargetValue(target)}
                    value={projectConfigTargetValue(target)}
                    className="py-2"
                    title={`${target.label} ${target.path}`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="relative -top-px max-w-[45%] min-w-0 truncate">
                        {target.label}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-foreground-muted">
                        {target.path}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldTitle>Settings to share</FieldTitle>
            <div className="grid grid-cols-2 gap-2">
              {availableFields.map((field) => (
                <label key={field} className="flex items-center gap-2 rounded-md py-2 text-sm">
                  <Checkbox
                    checked={selectedFields.includes(field)}
                    onCheckedChange={(checked) => toggleField(field, checked === true)}
                  />
                  <span>{projectConfigWriteFieldLabel(field)}</span>
                </label>
              ))}
            </div>
          </Field>
          {status === 'error' ? (
            <p className="text-xs text-foreground-error">{errorMessage}</p>
          ) : null}
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={status === 'writing'}>
          Cancel
        </Button>
        <ConfirmButton onClick={() => void handleWrite()} disabled={disabled}>
          <span className="inline-flex min-w-20 items-center justify-center gap-1.5">
            {status === 'writing' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {status === 'written' && <Check className="size-4" aria-hidden="true" />}
            {status === 'writing'
              ? 'Writing...'
              : status === 'written'
                ? 'Wrote .emdash.json'
                : 'Write .emdash.json'}
          </span>
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}
