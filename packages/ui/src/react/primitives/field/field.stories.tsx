import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx, cx } from '@styles/index';
import { surface } from '@styles/recipes/surface';
import React from 'react';
import { Input } from '@/react/primitives/input';
import { Switch } from '@/react/primitives/switch';
import { Textarea } from '@/react/primitives/textarea';
import { Field } from '.';
import * as s from '@/react/story-layout.css';
const meta: Meta = {
  title: 'Primitives/Field',
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj;
/** Simple text field with label, description, and error. */
export const Default: Story = {
  render: () => (
    <div className={s.w72}>
      <Field.Root>
        <Field.Label>Email address</Field.Label>
        <Input type="email" placeholder="you@example.com" />
        <Field.Description>We'll never share your email.</Field.Description>
      </Field.Root>
    </div>
  ),
};
/** Invalid state — error message appears, input border turns destructive. */
export const Invalid: Story = {
  render: () => (
    <div className={s.w72}>
      <Field.Root>
        <Field.Label>Email address</Field.Label>
        <Input type="email" defaultValue="not-an-email" aria-invalid="true" />
        <Field.Error>Please enter a valid email address.</Field.Error>
      </Field.Root>
    </div>
  ),
};
/** Disabled state. */
export const Disabled: Story = {
  render: () => (
    <div className={s.w72}>
      <Field.Root>
        <Field.Label>Name</Field.Label>
        <Input defaultValue="David Konopka" disabled />
        <Field.Description>This field cannot be changed.</Field.Description>
      </Field.Root>
    </div>
  ),
};
/** Base (32 px) vs SM (24 px) input sizes. */
export const Sizes: Story = {
  render: () => (
    <div
      className={cx(
        s.w72,
        sx({
          display: 'flex',
          flexDirection: 'column',
          gap: '4',
        })
      )}
    >
      <Field.Root>
        <Field.Label>Base (32 px)</Field.Label>
        <Input size="base" placeholder="Base size input" />
      </Field.Root>
      <Field.Root>
        <Field.Label>Small (24 px)</Field.Label>
        <Input size="sm" placeholder="Small size input" />
      </Field.Root>
    </div>
  ),
};
/** Textarea with field composition. */
export const WithTextarea: Story = {
  render: () => (
    <div className={s.w72}>
      <Field.Root>
        <Field.Label>Message</Field.Label>
        <Textarea placeholder="Type your message…" />
        <Field.Description>Max 500 characters.</Field.Description>
      </Field.Root>
    </div>
  ),
};
/** Horizontal layout — label/description on the left, control on the right (settings-row style). */
export const Horizontal: Story = {
  render: () => (
    <div
      className={cx(
        s.w72,
        sx({
          display: 'flex',
          flexDirection: 'column',
          gap: '3',
        })
      )}
    >
      <Field.Root orientation="horizontal">
        <Field.Content>
          <Field.Label>Send telemetry</Field.Label>
          <Field.Description>Anonymous usage data helps us improve.</Field.Description>
        </Field.Content>
        <Switch defaultChecked aria-label="Send telemetry" />
      </Field.Root>
      <Field.Root orientation="horizontal">
        <Field.Content>
          <Field.Label>Beta features</Field.Label>
          <Field.Description>Enable experimental functionality.</Field.Description>
        </Field.Content>
        <Switch aria-label="Beta features" />
      </Field.Root>
      <Field.Root orientation="horizontal">
        <Field.Content>
          <Field.Label>Name</Field.Label>
        </Field.Content>
        <Input placeholder="My Server" className={s.w40} />
      </Field.Root>
    </div>
  ),
};
/** FieldGroup — vertical stack of fields with consistent spacing (dialog-form style). */
export const Group: Story = {
  render: () => (
    <div className={s.w72}>
      <Field.Group>
        <Field.Root>
          <Field.Label>Name</Field.Label>
          <Input placeholder="My remote" />
        </Field.Root>
        <Field.Root>
          <Field.Label>URL</Field.Label>
          <Input placeholder="git@github.com:owner/repo.git" />
          <Field.Description>SSH or HTTPS remote URL.</Field.Description>
        </Field.Root>
        <Field.Root orientation="horizontal">
          <Field.Content>
            <Field.Label>Set as default</Field.Label>
          </Field.Content>
          <Switch aria-label="Set as default" />
        </Field.Root>
      </Field.Group>
    </div>
  ),
};
/** FieldSet + FieldLegend — semantic fieldset grouping; disabling it disables nested fields. */
export const FieldsetWithLegend: Story = {
  render: () => (
    <div
      className={cx(
        s.w72,
        sx({
          display: 'flex',
          flexDirection: 'column',
          gap: '6',
        })
      )}
    >
      <Field.Set>
        <Field.Legend>Notifications</Field.Legend>
        <Field.Group>
          <Field.Root orientation="horizontal">
            <Field.Content>
              <Field.Label>Task completed</Field.Label>
            </Field.Content>
            <Switch defaultChecked aria-label="Task completed" />
          </Field.Root>
          <Field.Root orientation="horizontal">
            <Field.Content>
              <Field.Label>Agent needs input</Field.Label>
            </Field.Content>
            <Switch aria-label="Agent needs input" />
          </Field.Root>
        </Field.Group>
      </Field.Set>
      <Field.Set disabled>
        <Field.Legend variant="label">Advanced (label-size legend, disabled)</Field.Legend>
        <Field.Root>
          <Field.Label>Poll interval</Field.Label>
          <Input placeholder="30s" disabled />
        </Field.Root>
      </Field.Set>
    </div>
  ),
};
/** All states on each surface level — verifies contrast and bg-transparent. */
export const AcrossSurfaces: Story = {
  render: () => (
    <div
      className={sx({
        background: 'surfaceSunken',
        display: 'flex',
        flexDirection: 'column',
        gap: '4',
        rounded: 'xl',
        padding: '4',
      })}
    >
      {(['sunken', 'base', 'raised', 'elevated', 'overlay'] as const).map((level) => (
        <div
          key={level}
          className={cx(
            surface({ level }),
            sx({
              display: 'flex',
              flexDirection: 'column',
              gap: '3',
              rounded: 'lg',
              padding: '4',
            })
          )}
        >
          <span style={{ fontSize: 'var(--em-text-xs)', color: 'var(--em-foreground-muted)' }}>
            {level}
          </span>
          <div
            className={cx(
              s.cols2,
              sx({
                display: 'grid',
                gap: '3',
              })
            )}
          >
            <Field.Root>
              <Field.Label>Default</Field.Label>
              <Input placeholder="Placeholder" />
            </Field.Root>
            <Field.Root>
              <Field.Label>Invalid</Field.Label>
              <Input defaultValue="bad value" aria-invalid="true" />
              <Field.Error>Error message</Field.Error>
            </Field.Root>
            <Field.Root>
              <Field.Label>Disabled</Field.Label>
              <Input placeholder="Disabled" disabled />
            </Field.Root>
            <Field.Root>
              <Field.Label>Small</Field.Label>
              <Input size="sm" placeholder="Small" />
            </Field.Root>
          </div>
        </div>
      ))}
    </div>
  ),
};
