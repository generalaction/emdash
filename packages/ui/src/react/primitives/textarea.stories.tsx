import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Textarea } from './textarea';
import * as s from '../story-layout.css';

const meta: Meta<typeof Textarea> = {
  title: 'Primitives/Textarea',
  component: Textarea,
  parameters: { layout: 'centered' },
  argTypes: {
    size: { control: 'select', options: ['base', 'sm'] },
  },
};

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  render: () => (
    <div className={s.w64}>
      <Textarea placeholder="Enter text…" />
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className={`${s.flex} ${s.w64} ${s.flexCol} ${s.gap3}`}>
      <Textarea size="base" placeholder="Base size textarea" />
      <Textarea size="sm" placeholder="Small size textarea" />
    </div>
  ),
};

export const WithValue: Story = {
  render: () => (
    <div className={s.w64}>
      <Textarea defaultValue="Some longer text that wraps over multiple lines in the textarea." />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className={s.w64}>
      <Textarea placeholder="Disabled" disabled />
    </div>
  ),
};

export const Invalid: Story = {
  render: () => (
    <div className={s.w64}>
      <Textarea placeholder="Invalid" aria-invalid="true" />
    </div>
  ),
};
