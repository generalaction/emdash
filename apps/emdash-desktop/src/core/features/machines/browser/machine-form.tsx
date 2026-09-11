import { FormFieldShell } from '@emdash/ui/react/form';
import { Input, ToggleGroup, Tooltip } from '@emdash/ui/react/primitives';
import { LoaderCircle } from 'lucide-react';
import { MachineAuthenticationFields } from './machine-authentication-fields';
import { MachineConnectionDetails } from './machine-connection-details';
import { MachineFormFeedback } from './machine-form-actions';
import { MachineHostPicker } from './machine-host-picker';
import { MachineManualFields, MachineManualRouting } from './machine-manual-fields';
import type { MachineFormController } from './use-machine-form';

export function MachineFormFields({
  controller,
  formId,
}: {
  controller: MachineFormController;
  formId: string;
}) {
  const {
    form,
    mode,
    selectMode,
    name,
    config,
    details,
    authentication,
    actions,
    feedback,
    isSaving,
  } = controller;
  const showConnection = mode === 'manual' || !!details;
  return (
    <Tooltip.Provider delay={150}>
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          actions.submit();
        }}
      >
        <fieldset disabled={isSaving} className="m-0 grid min-w-0 gap-4 border-0 p-0">
          <div className="grid gap-1">
            <div className="flex items-center gap-3">
              <form.AppField name="name">
                {(field) => (
                  <FormFieldShell className="min-w-0 flex-1">
                    {({ id, invalid }) => (
                      <Input
                        id={id}
                        name={field.name}
                        bare
                        autoFocus
                        aria-label="Connection name"
                        title="Optional. Defaults to the host."
                        placeholder={name.fallback || 'Connection name'}
                        className="min-w-0 px-0 text-lg!"
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        onBlur={field.handleBlur}
                        aria-invalid={!!name.error || invalid || undefined}
                        aria-describedby={name.error ? formId + '-name-error' : undefined}
                      />
                    )}
                  </FormFieldShell>
                )}
              </form.AppField>
              <ToggleGroup.Root
                aria-label="Connection source"
                className="shrink-0 bg-transparent"
                value={[mode]}
                onValueChange={([value]) => {
                  if (value === 'manual' || value === 'config') selectMode(value);
                }}
              >
                <ToggleGroup.Item value="config" disabled={isSaving}>
                  SSH config
                </ToggleGroup.Item>
                <ToggleGroup.Item value="manual" disabled={isSaving}>
                  Manual
                </ToggleGroup.Item>
              </ToggleGroup.Root>
            </div>
            {name.error && (
              <p
                id={formId + '-name-error'}
                role="alert"
                className="text-sm text-foreground-destructive"
              >
                {name.error}
              </p>
            )}
          </div>
          <div className="grid gap-4">
            {mode === 'config' && !showConnection && (
              <>
                <MachineHostPicker
                  id={formId + '-target'}
                  target={config.target}
                  onTargetChange={config.changeTarget}
                  hosts={config.hosts}
                  disabled={isSaving}
                />
                {config.suggestionsError && (
                  <p className="text-sm text-foreground-muted">{config.suggestionsError}</p>
                )}
                {config.resolution.status === 'resolving' && (
                  <p
                    role="status"
                    className="flex items-center gap-2 text-sm text-foreground-muted"
                  >
                    <LoaderCircle className="size-4 animate-spin" /> Resolving connection settings…
                  </p>
                )}
                {config.resolution.status === 'failed' && (
                  <p role="alert" className="text-sm text-foreground-destructive">
                    {config.resolution.error}
                  </p>
                )}
              </>
            )}
            {mode === 'config' && details && (
              <MachineConnectionDetails host={details} target={config.target} />
            )}
            {mode === 'manual' && <MachineManualFields form={form} />}
            {showConnection && (
              <MachineAuthenticationFields
                key={mode}
                form={form}
                mode={mode}
                alias={mode === 'config' ? config.target : ''}
                {...authentication}
              />
            )}
            {mode === 'manual' && <MachineManualRouting form={form} />}
          </div>
        </fieldset>
      </form>
      <MachineFormFeedback {...feedback} />
    </Tooltip.Provider>
  );
}
