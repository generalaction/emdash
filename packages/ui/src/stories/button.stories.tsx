import type { Meta, StoryObj } from '@storybook/react-vite';
import { PlusIcon, SearchIcon, TrashIcon } from 'lucide-react';
import React from 'react';
import { Button } from '../components/button';

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'outline', 'ghost', 'link'],
    },
    size: { control: 'select', options: ['default', 'sm', 'lg', 'icon', 'icon-sm', 'icon-lg'] },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {
  args: { children: 'Button', variant: 'default' },
};

/** The 4 shared variants: Primary (default), Outline, Ghost, Link. */
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="default">Primary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
};

/** The 3 logical sizes: sm / default / lg — each with text and icon form. */
export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm">Small</Button>
        <Button size="default">Default</Button>
        <Button size="lg">Large</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="icon-sm">
          <PlusIcon />
        </Button>
        <Button size="icon">
          <PlusIcon />
        </Button>
        <Button size="icon-lg">
          <PlusIcon />
        </Button>
      </div>
    </div>
  ),
};

/** All variants × all sizes. */
export const VariantSizeMatrix: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(['default', 'outline', 'ghost'] as const).map((variant) => (
        <div key={variant} className="flex flex-wrap items-center gap-3">
          {(['sm', 'default', 'lg'] as const).map((size) => (
            <Button key={size} variant={variant} size={size}>
              {variant} / {size}
            </Button>
          ))}
          {(['icon-sm', 'icon', 'icon-lg'] as const).map((size) => (
            <Button key={size} variant={variant} size={size}>
              <SearchIcon />
            </Button>
          ))}
        </div>
      ))}
    </div>
  ),
};

/** Buttons with a leading or trailing icon. */
export const WithIcon: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>
        <PlusIcon />
        Create
      </Button>
      <Button variant="outline">
        <PlusIcon />
        Add item
      </Button>
      <Button variant="ghost">
        <TrashIcon />
        Remove
      </Button>
    </div>
  ),
};

/** Disabled state across all shared variants. */
export const Disabled: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled>Primary</Button>
      <Button variant="outline" disabled>
        Outline
      </Button>
      <Button variant="ghost" disabled>
        Ghost
      </Button>
      <Button variant="link" disabled>
        Link
      </Button>
    </div>
  ),
};

/** Focus / invalid accessibility states. */
export const AccessibilityStates: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button aria-invalid="true">Invalid (default)</Button>
      <Button variant="outline" aria-invalid="true">
        Invalid (outline)
      </Button>
    </div>
  ),
};
