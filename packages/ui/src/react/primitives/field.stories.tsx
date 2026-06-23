import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Field, FieldDescription, FieldError, FieldLabel } from './field';
import { Input } from './input';
import { Surface } from './surface';
import { Textarea } from './textarea';
import * as s from '../story-layout.css';

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
    <div className={s.w72}>
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
    <div className={s.w72}>
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
    <div className={`${s.flex} ${s.w72} ${s.flexCol} ${s.gap4}`}>
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
    <div className={s.w72}>
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
    <div className={`${s.bgSurfaceSunken} ${s.flex} ${s.flexCol} ${s.gap4} ${s.roundedXl} ${s.p4}`}>
      {(['sunken', 'base', 'base-emphasis', 'elevated', 'elevated-emphasis'] as const).map(
        (level) => (
          <Surface
            key={level}
            level={level}
            className={`bg-surface ${s.flex} ${s.flexCol} ${s.gap3} ${s.roundedLg} ${s.p4}`}
          >
            <span className={`${s.textXs} ${s.textForegroundMuted}`}>{level}</span>
            <div className={`${s.grid} ${s.cols2} ${s.gap3}`}>
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
