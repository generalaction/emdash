import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Box } from '@/react/primitives/box';
import { Input } from '@/react/primitives/input';
import { Switch } from '@/react/primitives/switch';
import { Textarea } from '@/react/primitives/textarea';
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from './field';
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
    <Box className={s.w72}>
      <Field>
        <FieldLabel>Email address</FieldLabel>
        <Input type="email" placeholder="you@example.com" />
        <FieldDescription>We'll never share your email.</FieldDescription>
      </Field>
    </Box>
  ),
};

/** Invalid state — error message appears, input border turns destructive. */
export const Invalid: Story = {
  render: () => (
    <Box className={s.w72}>
      <Field>
        <FieldLabel>Email address</FieldLabel>
        <Input type="email" defaultValue="not-an-email" aria-invalid="true" />
        <FieldError>Please enter a valid email address.</FieldError>
      </Field>
    </Box>
  ),
};

/** Disabled state. */
export const Disabled: Story = {
  render: () => (
    <Box className={s.w72}>
      <Field>
        <FieldLabel>Name</FieldLabel>
        <Input defaultValue="David Konopka" disabled />
        <FieldDescription>This field cannot be changed.</FieldDescription>
      </Field>
    </Box>
  ),
};

/** Base (32 px) vs SM (24 px) input sizes. */
export const Sizes: Story = {
  render: () => (
    <Box display="flex" flexDirection="column" gap="4" className={s.w72}>
      <Field>
        <FieldLabel>Base (32 px)</FieldLabel>
        <Input size="base" placeholder="Base size input" />
      </Field>
      <Field>
        <FieldLabel>Small (24 px)</FieldLabel>
        <Input size="sm" placeholder="Small size input" />
      </Field>
    </Box>
  ),
};

/** Textarea with field composition. */
export const WithTextarea: Story = {
  render: () => (
    <Box className={s.w72}>
      <Field>
        <FieldLabel>Message</FieldLabel>
        <Textarea placeholder="Type your message…" />
        <FieldDescription>Max 500 characters.</FieldDescription>
      </Field>
    </Box>
  ),
};

/** Horizontal layout — label/description on the left, control on the right (settings-row style). */
export const Horizontal: Story = {
  render: () => (
    <Box display="flex" flexDirection="column" gap="3" className={s.w72}>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel>Send telemetry</FieldLabel>
          <FieldDescription>Anonymous usage data helps us improve.</FieldDescription>
        </FieldContent>
        <Switch defaultChecked aria-label="Send telemetry" />
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel>Beta features</FieldLabel>
          <FieldDescription>Enable experimental functionality.</FieldDescription>
        </FieldContent>
        <Switch aria-label="Beta features" />
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel>Name</FieldLabel>
        </FieldContent>
        <Input placeholder="My Server" className={s.w40} />
      </Field>
    </Box>
  ),
};

/** All states on each surface level — verifies contrast and bg-transparent. */
export const AcrossSurfaces: Story = {
  render: () => (
    <Box
      background="surfaceSunken"
      display="flex"
      flexDirection="column"
      gap="4"
      rounded="xl"
      padding="4"
    >
      {(['sunken', 'base', 'base-emphasis', 'elevated', 'elevated-emphasis'] as const).map(
        (level) => (
          <Box
            key={level}
            surface={level}
            display="flex"
            flexDirection="column"
            gap="3"
            rounded="lg"
            padding="4"
          >
            <span style={{ fontSize: 'var(--em-text-xs)', color: 'var(--em-foreground-muted)' }}>
              {level}
            </span>
            <Box display="grid" className={s.cols2} gap="3">
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
            </Box>
          </Box>
        )
      )}
    </Box>
  ),
};
