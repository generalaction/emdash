import { FormFieldShell, useFieldContext } from '@emdash/ui/react/form';
import { Button, Input, Select } from '@emdash/ui/react/primitives';
import { useState } from 'react';
import type { MachineFormMode } from './machine-form-model';
import type { MachineEditorForm } from './use-machine-form';

function PrivateKeyField({ inheritedKey, alias }: { inheritedKey?: string; alias: string }) {
  const field = useFieldContext<string>();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <FormFieldShell
      label="Private key"
      description={
        alias && (field.state.value || !inheritedKey) ? (
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>{field.state.value ? 'Custom key' : 'Enter a private key path'}</span>
            {field.state.value && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => {
                  field.handleChange('');
                  setDraft(null);
                }}
              >
                Reset to SSH config
              </Button>
            )}
          </span>
        ) : undefined
      }
    >
      {({ id, invalid }) => (
        <Input
          id={id}
          name={field.name}
          aria-invalid={invalid || undefined}
          value={draft ?? (field.state.value || inheritedKey || '')}
          placeholder="~/.ssh/id_ed25519"
          autoComplete="off"
          onChange={(event) => {
            setDraft(event.target.value);
            field.handleChange(event.target.value);
          }}
          onBlur={() => {
            setDraft(null);
            field.handleBlur();
          }}
        />
      )}
    </FormFieldShell>
  );
}

export function MachineAuthenticationFields({
  form,
  mode,
  alias,
  inheritedKey,
  reuse,
}: {
  form: MachineEditorForm;
  mode: MachineFormMode;
  alias: string;
  inheritedKey?: string;
  reuse: { password: boolean; passphrase: boolean };
}) {
  return (
    <section className="grid gap-3" aria-label="Authentication settings">
      <form.AppField name={`${mode}.authType`}>
        {(field) => (
          <FormFieldShell label="Authentication" orientation="horizontal">
            {({ id }) => (
              <Select.Root
                value={field.state.value}
                onValueChange={(value) => {
                  if (value) field.handleChange(value);
                }}
              >
                <Select.Trigger id={id} onBlur={field.handleBlur}>
                  <Select.Value>
                    {field.state.value === 'key'
                      ? 'SSH Key'
                      : field.state.value === 'agent'
                        ? 'Agent'
                        : 'Password'}
                  </Select.Value>
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="key">SSH Key</Select.Item>
                  <Select.Item value="agent">Agent</Select.Item>
                  <Select.Item value="password">Password</Select.Item>
                </Select.Content>
              </Select.Root>
            )}
          </FormFieldShell>
        )}
      </form.AppField>
      <form.Subscribe
        selector={(state) => ({
          authType: state.values[mode].authType,
        })}
      >
        {({ authType }) =>
          authType === 'key' ? (
            <>
              <form.AppField name={`${mode}.privateKeyPath`}>
                {() => <PrivateKeyField key={alias} alias={alias} inheritedKey={inheritedKey} />}
              </form.AppField>
              <form.AppField name={`${mode}.passphrase`}>
                {(field) => (
                  <field.TextField
                    label="Passphrase (optional)"
                    type="password"
                    autoComplete="off"
                    placeholder={reuse.passphrase ? 'Leave blank to keep existing' : 'Optional'}
                  />
                )}
              </form.AppField>
            </>
          ) : authType === 'password' ? (
            <form.AppField name={`${mode}.password`}>
              {(field) => (
                <field.TextField
                  label="Password"
                  type="password"
                  autoComplete="current-password"
                  placeholder={reuse.password ? 'Leave blank to keep existing' : undefined}
                />
              )}
            </form.AppField>
          ) : (
            <p className="text-sm text-foreground-muted">Uses keys available in your SSH agent.</p>
          )
        }
      </form.Subscribe>
    </section>
  );
}
