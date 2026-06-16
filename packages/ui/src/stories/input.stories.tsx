import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Input } from '../components/input';

const meta: Meta<typeof Input> = {
  title: 'Components/Input',
  component: Input,
  parameters: { layout: 'centered' },
  argTypes: {
    disabled: { control: 'boolean' },
    placeholder: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  render: () => (
    <div className="w-64">
      <Input placeholder="Enter text…" />
    </div>
  ),
};

export const WithValue: Story = {
  render: () => (
    <div className="w-64">
      <Input defaultValue="Hello world" />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="w-64">
      <Input placeholder="Disabled" disabled />
    </div>
  ),
};

export const Invalid: Story = {
  render: () => (
    <div className="w-64">
      <Input placeholder="Invalid" aria-invalid="true" />
    </div>
  ),
};

export const Types: Story = {
  render: () => (
    <div className="flex w-64 flex-col gap-3">
      <Input type="text" placeholder="Text" />
      <Input type="email" placeholder="Email" />
      <Input type="password" placeholder="Password" />
      <Input type="number" placeholder="Number" />
      <Input type="search" placeholder="Search" />
    </div>
  ),
};
