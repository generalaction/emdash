import type { Meta, StoryObj } from '@storybook/react-vite';
import { PlusIcon, TrashIcon } from 'lucide-react';
import React from 'react';
import { Button } from '../components/button';

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'],
    },
    size: { control: 'select', options: ['default', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm'] },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {
  args: { children: 'Button', variant: 'default' },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="default">Default</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="lg">Large</Button>
      <Button size="default">Default</Button>
      <Button size="sm">Small</Button>
      <Button size="icon">
        <PlusIcon />
      </Button>
      <Button size="icon-sm">
        <PlusIcon />
      </Button>
      <Button size="icon-xs">
        <PlusIcon />
      </Button>
    </div>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>
        <PlusIcon />
        Create
      </Button>
      <Button variant="destructive">
        <TrashIcon />
        Delete
      </Button>
      <Button variant="outline">
        <PlusIcon />
        Add item
      </Button>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled>Default</Button>
      <Button variant="outline" disabled>
        Outline
      </Button>
      <Button variant="secondary" disabled>
        Secondary
      </Button>
      <Button variant="ghost" disabled>
        Ghost
      </Button>
    </div>
  ),
};

export const Invalid: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button aria-invalid="true">Default</Button>
      <Button variant="outline" aria-invalid="true">
        Outline
      </Button>
    </div>
  ),
};
