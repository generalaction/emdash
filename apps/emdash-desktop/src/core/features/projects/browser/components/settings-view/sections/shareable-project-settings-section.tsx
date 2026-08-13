import { Button, Field, Input, Separator, Switch, Textarea } from '@emdash/ui/react/primitives';
import { Fragment } from 'react';
import { openExternal } from '@core/primitives/desktop-host/browser/host-client';
import type {
  ProjectConfigMigration,
  ShareableProjectSettingsWriteField,
} from '@core/primitives/project-settings/api';
import type {
  ProjectFileHandlingDomainSnapshot,
  ProjectLifecycleDomainSnapshot,
} from '../../../../api/project-settings-page';
import { ConfigMigrationNotice } from '../config-migration-notice';
import {
  effectiveAutoRunToggleValue,
  type FileHandlingFormState,
  type FormUpdate,
  type LifecycleFormState,
} from '../project-settings-form-model';
import {
  SHAREABLE_FIELD_DESCRIPTORS,
  type ShareableFieldDescriptor,
} from '../shareable-project-settings-fields';
import { ShareableSettingTitle } from '../shareable-setting-title';

type ShareableSettingsSectionProps = {
  lifecycleForm: LifecycleFormState;
  fileHandlingForm: FileHandlingFormState;
  updateLifecycle: FormUpdate<LifecycleFormState>;
  updateFileHandling: FormUpdate<FileHandlingFormState>;
  getOverrideSources: (
    field: ShareableProjectSettingsWriteField
  ) => { label: string; path: string; value: string }[];
  configMigrations: ProjectConfigMigration[];
  importDisabled: boolean;
  openImportConfigModal: () => void;
  lifecycle: ProjectLifecycleDomainSnapshot;
  fileHandling: ProjectFileHandlingDomainSnapshot;
};

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ShareableField({
  descriptor,
  value,
  isPersonal,
  onChange,
  getOverrideSources,
  beforeInput,
}: {
  descriptor: ShareableFieldDescriptor;
  value: string;
  isPersonal: boolean;
  onChange: (value: string) => void;
  getOverrideSources: ShareableSettingsSectionProps['getOverrideSources'];
  beforeInput?: React.ReactNode;
}) {
  return (
    <Field.Root>
      <ShareableSettingTitle
        leafLabel={descriptor.leafLabel}
        overrideSources={getOverrideSources(descriptor.id)}
        isPersonal={isPersonal}
        onRestore={() => onChange('')}
      >
        {descriptor.group ? titleCase(descriptor.leafLabel) : descriptor.modalLabel}
      </ShareableSettingTitle>
      {descriptor.description ? (
        <Field.Description className="text-foreground-muted">
          {descriptor.description}
        </Field.Description>
      ) : null}
      {beforeInput}
      {descriptor.multiline ? (
        <Textarea
          rows={descriptor.id === 'preservePatterns' ? 5 : 3}
          placeholder={descriptor.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          placeholder={descriptor.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field.Root>
  );
}

function AutoRunToggle({
  label,
  value,
  resolved,
  onCheckedChange,
  onReset,
}: {
  label: string;
  value: boolean | undefined;
  resolved: {
    value: boolean;
    from: ProjectLifecycleDomainSnapshot['resolved']['autoRunSetup']['from'];
  };
  onCheckedChange: (checked: boolean) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground-muted">{label}</span>
      <div className="flex items-center gap-2">
        {value !== undefined ? (
          <Button type="button" variant="ghost" size="xs" onClick={onReset}>
            Reset
          </Button>
        ) : null}
        <Switch
          checked={effectiveAutoRunToggleValue(value, resolved.value)}
          onCheckedChange={onCheckedChange}
        />
      </div>
    </div>
  );
}

export function ShareableSettingsSection({
  lifecycleForm,
  fileHandlingForm,
  updateLifecycle,
  updateFileHandling,
  getOverrideSources,
  configMigrations,
  importDisabled,
  openImportConfigModal,
  lifecycle,
  fileHandling,
}: ShareableSettingsSectionProps) {
  const topLevelFields = SHAREABLE_FIELD_DESCRIPTORS.filter((descriptor) => !descriptor.group);
  const lifecycleFields = SHAREABLE_FIELD_DESCRIPTORS.filter(
    (descriptor) => descriptor.group === 'lifecycle'
  );
  const valueFor = (descriptor: ShareableFieldDescriptor): string =>
    descriptor.id === 'preservePatterns'
      ? fileHandlingForm.preservePatterns
      : (lifecycleForm[descriptor.formKey as keyof LifecycleFormState] as string);
  const updateField = (descriptor: ShareableFieldDescriptor, value: string): void => {
    if (descriptor.id === 'preservePatterns') {
      updateFileHandling('preservePatterns', value);
      return;
    }
    updateLifecycle(descriptor.formKey as keyof LifecycleFormState, value);
  };
  const hasPersonalValue = (descriptor: ShareableFieldDescriptor): boolean => {
    if (valueFor(descriptor).trim()) return true;
    if (descriptor.id === 'preservePatterns') {
      return fileHandling.personal.preservePatterns !== undefined;
    }
    const script = descriptor.id.slice('scripts.'.length) as
      | 'prepare'
      | 'setup'
      | 'run'
      | 'teardown';
    return lifecycle.personal.scripts?.[script] !== undefined;
  };

  return (
    <>
      <Separator />

      {topLevelFields.map((descriptor, index) => (
        <Fragment key={descriptor.id}>
          {index > 0 ? <Separator /> : null}
          <ShareableField
            descriptor={descriptor}
            value={valueFor(descriptor)}
            isPersonal={hasPersonalValue(descriptor)}
            onChange={(value) => updateField(descriptor, value)}
            getOverrideSources={getOverrideSources}
          />
        </Fragment>
      ))}

      <Separator />

      <div className="flex flex-col gap-4">
        <Field.Root className="gap-1">
          <Field.Label>Lifecycle scripts</Field.Label>
          <Field.Description className="text-foreground-muted">
            Shell commands run at each stage of the worktree lifecycle. Prepare blocks task startup;
            Setup and Run start after the workspace is ready. When both are set to auto-run, Run
            waits for Setup to complete.
            <span> See </span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="group text-muted-foreground inline-flex h-auto cursor-pointer items-center gap-1 px-0 text-sm font-normal hover:text-foreground hover:no-underline focus-visible:ring-0 focus-visible:outline-none"
              onClick={() => openExternal('https://www.emdash.sh/docs/project-config')}
            >
              <span className="font-sans text-xs transition-colors group-hover:text-foreground">
                docs
              </span>
              <span className="text-muted-foreground text-sm transition-colors group-hover:text-foreground">
                ↗
              </span>
            </Button>
            <span> for the full project config reference.</span>
          </Field.Description>
        </Field.Root>

        {lifecycleFields.map((descriptor) => (
          <ShareableField
            key={descriptor.id}
            descriptor={descriptor}
            value={valueFor(descriptor)}
            isPersonal={hasPersonalValue(descriptor)}
            onChange={(value) => updateField(descriptor, value)}
            getOverrideSources={getOverrideSources}
            beforeInput={
              descriptor.id === 'scripts.setup' ? (
                <AutoRunToggle
                  label="Auto-run on task creation"
                  value={lifecycleForm.autoRunSetupScriptOnTaskCreation}
                  resolved={lifecycle.resolved.autoRunSetup}
                  onCheckedChange={(checked) =>
                    updateLifecycle('autoRunSetupScriptOnTaskCreation', checked)
                  }
                  onReset={() => updateLifecycle('autoRunSetupScriptOnTaskCreation', undefined)}
                />
              ) : descriptor.id === 'scripts.run' ? (
                <AutoRunToggle
                  label="Auto-run on task creation"
                  value={lifecycleForm.autoRunRunScriptOnTaskCreation}
                  resolved={lifecycle.resolved.autoRunRun}
                  onCheckedChange={(checked) =>
                    updateLifecycle('autoRunRunScriptOnTaskCreation', checked)
                  }
                  onReset={() => updateLifecycle('autoRunRunScriptOnTaskCreation', undefined)}
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
