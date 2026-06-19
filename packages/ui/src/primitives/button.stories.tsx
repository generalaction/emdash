import type { Meta, StoryObj } from '@storybook/react-vite';
import { PlusIcon, SearchIcon, TrashIcon } from 'lucide-react';
import React from 'react';
import { Button } from './button';
import { Surface } from './surface';

const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: { control: 'select', options: ['ghost', 'primary'] },
    tone: { control: 'select', options: ['neutral', 'destructive'] },
    size: { control: 'select', options: ['base', 'sm', 'link'] },
    icon: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {
  args: { children: 'Button', variant: 'ghost' },
};

/** All variants × tones. */
export const VariantMatrix: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(['ghost', 'primary'] as const).map((variant) => (
        <div key={variant} className="flex flex-wrap items-center gap-2">
          {(['neutral', 'destructive'] as const).map((tone) => (
            <Button key={tone} variant={variant} tone={tone}>
              {variant} / {tone}
            </Button>
          ))}
        </div>
      ))}
    </div>
  ),
};

/** Base (32 px) and SM (24 px) sizes, plus Link. */
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Button size="base">Base</Button>
        <Button size="sm">Small</Button>
        <Button size="link">Link</Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Button size="base" icon>
          <SearchIcon />
        </Button>
        <Button size="sm" icon>
          <SearchIcon />
        </Button>
      </div>
    </div>
  ),
};

/** Icon-only icon buttons. */
export const IconButtons: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button icon>
        <PlusIcon />
      </Button>
      <Button icon variant="primary">
        <PlusIcon />
      </Button>
      <Button icon size="sm">
        <SearchIcon />
      </Button>
      <Button icon tone="destructive">
        <TrashIcon />
      </Button>
    </div>
  ),
};

/** Disabled state. */
export const Disabled: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled>Ghost</Button>
      <Button variant="primary" disabled>
        Primary
      </Button>
      <Button tone="destructive" disabled>
        Destructive
      </Button>
    </div>
  ),
};

/** Surface-relative hover / active adapt correctly across all backgrounds. */
export const AcrossSurfaces: Story = {
  render: () => (
    <div className="flex flex-col gap-4 rounded-xl p-4 bg-surface-sunken">
      {(
        [
          'sunken',
          'base',
          'base-emphasis',
          'elevated',
          'elevated-emphasis',
        ] as const
      ).map((level) => (
        <Surface
          key={level}
          level={level}
          className="flex flex-wrap items-center gap-2 rounded-lg p-3 bg-surface"
        >
          <span className="w-36 text-xs text-foreground-muted">{level}</span>
          <Button>Ghost</Button>
          <Button variant="primary">Primary</Button>
          <Button tone="destructive">Destructive</Button>
          <Button icon>
            <SearchIcon />
          </Button>
        </Surface>
      ))}
    </div>
  ),
};
