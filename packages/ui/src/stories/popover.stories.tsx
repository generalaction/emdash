import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Button } from '../primitives/button';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '../primitives/popover';

const meta: Meta = {
  title: 'Components/Popover',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger>
        <Button variant="outline">Open popover</Button>
      </PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Popover title</PopoverTitle>
          <PopoverDescription>
            This is a short description of the popover content.
          </PopoverDescription>
        </PopoverHeader>
        <p className="text-sm text-foreground-muted">Some body content here.</p>
      </PopoverContent>
    </Popover>
  ),
};

export const WithCloseButton: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger>
        <Button variant="outline">Open popover</Button>
      </PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Settings</PopoverTitle>
          <PopoverClose>
            <Button variant="ghost" size="icon-xs">
              ×
            </Button>
          </PopoverClose>
        </PopoverHeader>
        <p className="text-sm text-foreground-muted">Configure your preferences here.</p>
      </PopoverContent>
    </Popover>
  ),
};

export const Aligned: Story = {
  render: () => (
    <div className="flex gap-4">
      {(['start', 'center', 'end'] as const).map((align) => (
        <Popover key={align}>
          <PopoverTrigger>
            <Button variant="outline" size="sm">
              {align}
            </Button>
          </PopoverTrigger>
          <PopoverContent align={align}>
            <p className="text-sm">Aligned: {align}</p>
          </PopoverContent>
        </Popover>
      ))}
    </div>
  ),
};
