import { tokens } from '@emdash/theme';
import { SeparatedList } from '@react/primitives/separated-list';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx, sx } from '@styles/index';
import { useState } from 'react';
import { SettingsCard } from '../settings/settings-card';
import { useAppForm } from './use-app-form';
import * as s from '@react/story-layout.css';

const meta: Meta = {
  title: 'Form/useAppForm',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

// ── Vertical form ─────────────────────────────────────────────────────────────

function VerticalFormDemo() {
  const [submitted, setSubmitted] = useState<Record<string, unknown> | null>(null);

  const form = useAppForm({
    defaultValues: {
      name: '',
      email: '',
      port: 22,
      notes: '',
      authType: 'password',
      provider: '',
    },
    validators: {
      onSubmit: ({ value }) => {
        if (!value.name.trim()) {
          return { fields: { name: 'Name is required.' } };
        }
        if (!value.email.includes('@')) {
          return { fields: { email: 'Enter a valid email address.' } };
        }
        return undefined;
      },
    },
    onSubmit: ({ value }) => {
      setSubmitted(value);
    },
  });

  return (
    <div
      className={cx(
        s.w72,
        sx({
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space.step4,
        })
      )}
    >
      {submitted && (
        <pre
          className={sx({
            fontSize: 'xs',
            background: tokens.surface.current.hover,
            p: tokens.space.step2,
            borderRadius: tokens.radius.md,
          })}
        >
          {JSON.stringify(submitted, null, 2)}
        </pre>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div
          className={sx({
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.space.step3,
          })}
        >
          <form.AppField name="name">
            {(f) => <f.TextField label="Name" placeholder="My Server" />}
          </form.AppField>

          <form.AppField name="email">
            {(f) => <f.TextField label="Email" type="email" placeholder="you@example.com" />}
          </form.AppField>

          <form.AppField name="port">{(f) => <f.NumberField label="Port" />}</form.AppField>

          <form.AppField name="authType">
            {(f) => (
              <f.RadioGroupField
                label="Authentication"
                layout="row"
                options={[
                  { value: 'password', label: 'Password' },
                  { value: 'key', label: 'SSH key' },
                  { value: 'agent', label: 'Agent' },
                ]}
              />
            )}
          </form.AppField>

          <form.AppField name="provider">
            {(f) => (
              <f.ComboboxSelectField
                label="Provider (combobox)"
                placeholder="Select a provider…"
                searchPlaceholder="Search providers…"
                options={[
                  { value: 'claude', label: 'Claude' },
                  { value: 'gpt', label: 'GPT-4o' },
                  { value: 'gemini', label: 'Gemini' },
                  { value: 'codex', label: 'Codex' },
                ]}
              />
            )}
          </form.AppField>

          <form.AppField name="notes">
            {(f) => <f.TextareaField label="Notes" placeholder="Optional notes…" />}
          </form.AppField>

          <form.AppForm>
            <form.SubmitButton>Save</form.SubmitButton>
          </form.AppForm>
        </div>
      </form>
    </div>
  );
}

export const VerticalForm: Story = {
  render: () => <VerticalFormDemo />,
};

// ── Invalid state ─────────────────────────────────────────────────────────────

function InvalidFormDemo() {
  const form = useAppForm({
    defaultValues: { name: '', email: 'bad-email' },
    validators: {
      onChange: ({ value }) => {
        const fields: Record<string, string> = {};
        if (!value.name.trim()) fields['name'] = 'Name is required.';
        if (!value.email.includes('@')) fields['email'] = 'Enter a valid email address.';
        return Object.keys(fields).length ? { fields } : undefined;
      },
    },
    onSubmit: () => {},
  });

  return (
    <div className={s.w72}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div
          className={sx({
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.space.step3,
          })}
        >
          <form.AppField name="name">
            {(f) => <f.TextField label="Name" placeholder="Required" />}
          </form.AppField>
          <form.AppField name="email">
            {(f) => <f.TextField label="Email" type="email" placeholder="you@example.com" />}
          </form.AppField>
          <form.AppForm>
            <form.SubmitButton>Submit</form.SubmitButton>
          </form.AppForm>
        </div>
      </form>
    </div>
  );
}

export const InvalidState: Story = {
  render: () => <InvalidFormDemo />,
};

// ── Horizontal settings panel ─────────────────────────────────────────────────

function SettingsPanelDemo() {
  const form = useAppForm({
    defaultValues: {
      telemetry: true,
      betaFeatures: false,
      theme: 'system',
      displayName: 'David',
    },
    onSubmit: () => {},
  });

  return (
    <SettingsCard className={s.w96}>
      <form onSubmit={(e) => e.preventDefault()}>
        <SeparatedList gap="0.75rem">
          <form.AppField name="telemetry">
            {(f) => (
              <f.SwitchField
                label="Send telemetry"
                description="Anonymous usage data helps us improve."
              />
            )}
          </form.AppField>

          <form.AppField name="betaFeatures">
            {(f) => (
              <f.SwitchField
                label="Beta features"
                description="Enable experimental functionality."
              />
            )}
          </form.AppField>

          <form.AppField name="theme">
            {(f) => (
              <f.SelectField
                orientation="horizontal"
                label="Theme"
                description="Appearance of the interface."
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
              />
            )}
          </form.AppField>

          <form.AppField name="displayName">
            {(f) => (
              <f.TextField
                orientation="horizontal"
                label="Display name"
                description="Shown in the title bar."
              />
            )}
          </form.AppField>
        </SeparatedList>
      </form>
    </SettingsCard>
  );
}

export const SettingsPanel: Story = {
  render: () => <SettingsPanelDemo />,
};
