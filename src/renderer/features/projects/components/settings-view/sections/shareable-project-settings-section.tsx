import { Fragment } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Field, FieldDescription, FieldTitle } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Separator } from '@renderer/lib/ui/separator';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import type {
  ProjectConfigMigration,
  ProjectSettingsOverrideState,
  ShareableProjectSettingsWriteField,
} from '@shared/core/project-settings/project-settings';
import { ConfigMigrationNotice } from '../config-migration-notice';
import type { FormState, FormUpdate } from '../project-settings-form-model';
import {
  SHAREABLE_FIELD_DESCRIPTORS,
  type ShareableFieldDescriptor,
} from '../shareable-project-settings-fields';
import { ShareableSettingTitle } from '../shareable-setting-title';

type ShareableSettingsSectionProps = {
  form: FormState;
  update: FormUpdate;
  getOverrideSources: (
    field: ShareableProjectSettingsWriteField
  ) => ProjectSettingsOverrideState[ShareableProjectSettingsWriteField];
  configMigrations: ProjectConfigMigration[];
  importDisabled: boolean;
  openImportConfigModal: () => void;
};

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ShareableField({
  descriptor,
  form,
  update,
  getOverrideSources,
  beforeInput,
}: {
  descriptor: ShareableFieldDescriptor;
  form: FormState;
  update: FormUpdate;
  getOverrideSources: ShareableSettingsSectionProps['getOverrideSources'];
  beforeInput?: React.ReactNode;
}) {
  return (
    <Field>
      <ShareableSettingTitle
        leafLabel={descriptor.leafLabel}
        overrideSources={getOverrideSources(descriptor.id)}
        onRestore={() => update(descriptor.formKey, '')}
      >
        {descriptor.group ? titleCase(descriptor.leafLabel) : descriptor.modalLabel}
      </ShareableSettingTitle>
      {descriptor.description ? (
        <FieldDescription className="text-foreground-muted">
          {descriptor.description}
        </FieldDescription>
      ) : null}
      {beforeInput}
      {descriptor.multiline ? (
        <Textarea
          rows={descriptor.id === 'preservePatterns' ? 5 : 3}
          placeholder={descriptor.placeholder}
          value={form[descriptor.formKey]}
          onChange={(e) => update(descriptor.formKey, e.target.value)}
        />
      ) : (
        <Input
          placeholder={descriptor.placeholder}
          value={form[descriptor.formKey]}
          onChange={(e) => update(descriptor.formKey, e.target.value)}
        />
      )}
    </Field>
  );
}

function AutoRunToggle({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-foreground-muted">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

export function ShareableSettingsSection({
  form,
  update,
  getOverrideSources,
  configMigrations,
  importDisabled,
  openImportConfigModal,
}: ShareableSettingsSectionProps) {
  const topLevelFields = SHAREABLE_FIELD_DESCRIPTORS.filter((descriptor) => !descriptor.group);
  const lifecycleFields = SHAREABLE_FIELD_DESCRIPTORS.filter(
    (descriptor) => descriptor.group === 'lifecycle'
  );

  return (
    <>
      <Separator />

      {topLevelFields.map((descriptor, index) => (
        <Fragment key={descriptor.id}>
          {index > 0 ? <Separator /> : null}
          <ShareableField
            descriptor={descriptor}
            form={form}
            update={update}
            getOverrideSources={getOverrideSources}
          />
        </Fragment>
      ))}

      <Separator />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <FieldTitle>Lifecycle scripts</FieldTitle>
          <FieldDescription className="text-foreground-muted">
            Shell commands run at each stage of the worktree lifecycle. One command per line. When
            both are set to auto-run, the Run script waits for Setup to complete.
            <span> See </span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="group text-muted-foreground inline-flex h-auto cursor-pointer items-center gap-1 px-0 text-sm font-normal hover:text-foreground hover:no-underline focus-visible:ring-0 focus-visible:outline-none"
              onClick={() => rpc.app.openExternal('https://www.emdash.sh/docs/project-config')}
            >
              <span className="font-mono text-xs transition-colors group-hover:text-foreground">
                docs
              </span>
              <span className="text-muted-foreground text-sm transition-colors group-hover:text-foreground">
                ↗
              </span>
            </Button>
            <span> for the full project config reference.</span>
          </FieldDescription>
        </div>

        {lifecycleFields.map((descriptor) => (
          <ShareableField
            key={descriptor.id}
            descriptor={descriptor}
            form={form}
            update={update}
            getOverrideSources={getOverrideSources}
            beforeInput={
              descriptor.id === 'scripts.setup' ? (
                <AutoRunToggle
                  label="Auto-run on task creation"
                  checked={form.autoRunSetupScriptOnTaskCreation}
                  onCheckedChange={(checked) => update('autoRunSetupScriptOnTaskCreation', checked)}
                />
              ) : descriptor.id === 'scripts.run' ? (
                <AutoRunToggle
                  label="Auto-run on task creation"
                  checked={form.autoRunRunScriptOnTaskCreation}
                  onCheckedChange={(checked) => update('autoRunRunScriptOnTaskCreation', checked)}
                />
              ) : undefined
            }
          />
        ))}

        <ConfigMigrationNotice
          migrations={configMigrations}
          disabled={importDisabled}
          onImport={openImportConfigModal}
        />
      </div>
    </>
  );
}
