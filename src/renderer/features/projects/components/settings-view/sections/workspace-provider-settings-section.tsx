import { Field, FieldDescription, FieldTitle } from '@renderer/lib/ui/field';
import { Separator } from '@renderer/lib/ui/separator';
import { Textarea } from '@renderer/lib/ui/textarea';
import type {
  FormState,
  FormUpdate,
  WorkspaceProviderValidationErrors,
} from '../project-settings-form-model';

type WorkspaceProviderSettingsSectionProps = {
  enabled: boolean;
  form: FormState;
  errors: WorkspaceProviderValidationErrors;
  update: FormUpdate;
};

export function WorkspaceProviderSettingsSection({
  enabled,
  form,
  errors,
  update,
}: WorkspaceProviderSettingsSectionProps) {
  if (!enabled) return null;

  return (
    <>
      <Separator />
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <FieldTitle>Workspace provider</FieldTitle>
          <FieldDescription className="text-foreground-muted">
            Commands used to provision and terminate BYOI infrastructure for tasks.
          </FieldDescription>
        </div>

        <Field>
          <FieldTitle>Provision command</FieldTitle>
          <Textarea
            aria-invalid={errors.provisionCommand ? true : undefined}
            rows={3}
            placeholder="./scripts/provision-workspace.sh"
            value={form.provisionCommand}
            onChange={(e) => update('provisionCommand', e.target.value)}
          />
          {errors.provisionCommand ? (
            <p className="text-xs text-red-500">{errors.provisionCommand}</p>
          ) : null}
        </Field>
        <Field>
          <FieldTitle>Terminate command</FieldTitle>
          <Textarea
            aria-invalid={errors.terminateCommand ? true : undefined}
            rows={3}
            placeholder="./scripts/terminate-workspace.sh"
            value={form.terminateCommand}
            onChange={(e) => update('terminateCommand', e.target.value)}
          />
          {errors.terminateCommand ? (
            <p className="text-xs text-red-500">{errors.terminateCommand}</p>
          ) : null}
        </Field>
      </div>
    </>
  );
}
