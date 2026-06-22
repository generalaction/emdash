import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Field, FieldDescription, FieldError, FieldLabel } from './field';
import { Input } from './input';
import { Surface } from './surface';
import { Textarea } from './textarea';

const meta: Meta = {
  title: 'Primitives/Field',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

/** Simple text field with label, description, and error. */
export const Default: Story = {
  render: () => (
    <div className="w-72">
      <Field>
        <FieldLabel>Email address</FieldLabel>
        <Input type="email" placeholder="you@example.com" />
        <FieldDescription>We'll never share your email.</FieldDescription>
      </Field>
    </div>
  ),
};

/** Invalid state — error message appears, input border turns destructive. */
export const Invalid: Story = {
  render: () => (
    <div className="w-72">
      <Field>
        <FieldLabel>Email address</FieldLabel>
        <Input type="email" defaultValue="not-an-email" aria-invalid="true" />
        <FieldError>Please enter a valid email address.</FieldError>
      </Field>
    </div>
  ),
};

/** Disabled state. */
export const Disabled: Story = {
  render: () => (
    <div className="w-72">
      <Field>
        <FieldLabel>Name</FieldLabel>
        <Input defaultValue="David Konopka" disabled />
        <FieldDescription>This field cannot be changed.</FieldDescription>
      </Field>
    </div>
  ),
};

/** Base (32 px) vs SM (24 px) input sizes. */
export const Sizes: Story = {
  render: () => (
    <div className="flex w-72 flex-col gap-4">
      <Field>
        <FieldLabel>Base (32 px)</FieldLabel>
        <Input size="base" placeholder="Base size input" />
      </Field>
      <Field>
        <FieldLabel>Small (24 px)</FieldLabel>
        <Input size="sm" placeholder="Small size input" />
      </Field>
    </div>
  ),
};

/** Textarea with field composition. */
export const WithTextarea: Story = {
  render: () => (
    <div className="w-72">
      <Field>
        <FieldLabel>Message</FieldLabel>
        <Textarea placeholder="Type your message…" />
        <FieldDescription>Max 500 characters.</FieldDescription>
      </Field>
    </div>
  ),
};

/** All states on each surface level — verifies contrast and bg-transparent. */
export const AcrossSurfaces: Story = {
  render: () => (
    <div className="flex flex-col gap-4 rounded-xl bg-surface-sunken p-4">
      {(['sunken', 'base', 'base-emphasis', 'elevated', 'elevated-emphasis'] as const).map(
        (level) => (
          <Surface
            key={level}
            level={level}
            className="flex flex-col gap-3 rounded-lg bg-surface p-4"
          >
            <span className="text-xs text-foreground-muted">{level}</span>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>Default</FieldLabel>
                <Input placeholder="Placeholder" />
              </Field>
              <Field>
                <FieldLabel>Invalid</FieldLabel>
                <Input defaultValue="bad value" aria-invalid="true" />
                <FieldError>Error message</FieldError>
              </Field>
              <Field>
                <FieldLabel>Disabled</FieldLabel>
                <Input placeholder="Disabled" disabled />
              </Field>
              <Field>
                <FieldLabel>Small</FieldLabel>
                <Input size="sm" placeholder="Small" />
              </Field>
            </div>
          </Surface>
        )
      )}
    </div>
  ),
};
