import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Textarea } from '../components/textarea';

const meta: Meta<typeof Textarea> = {
  title: 'Components/Textarea',
  component: Textarea,
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  render: () => (
    <div className="w-64">
      <Textarea placeholder="Enter text…" />
    </div>
  ),
};

export const WithValue: Story = {
  render: () => (
    <div className="w-64">
      <Textarea defaultValue="Some longer text that wraps over multiple lines in the textarea." />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="w-64">
      <Textarea placeholder="Disabled" disabled />
    </div>
  ),
};

export const Invalid: Story = {
  render: () => (
    <div className="w-64">
      <Textarea placeholder="Invalid" aria-invalid="true" />
    </div>
  ),
};
