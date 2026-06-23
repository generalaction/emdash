import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Button } from './button';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from './popover';
import * as s from '../story-layout.css';

const meta: Meta = {
  title: 'Primitives/Popover',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger>
        <Button variant="ghost">Open popover</Button>
      </PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Popover title</PopoverTitle>
          <PopoverDescription>
            This is a short description of the popover content.
          </PopoverDescription>
        </PopoverHeader>
        <p className={`${s.textSm} ${s.textForegroundMuted}`}>Some body content here.</p>
      </PopoverContent>
    </Popover>
  ),
};

export const WithCloseButton: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger>
        <Button variant="ghost">Open popover</Button>
      </PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Settings</PopoverTitle>
          <PopoverClose>
            <Button variant="ghost" size="sm" icon>
              ×
            </Button>
          </PopoverClose>
        </PopoverHeader>
        <p className={`${s.textSm} ${s.textForegroundMuted}`}>Configure your preferences here.</p>
      </PopoverContent>
    </Popover>
  ),
};

export const Aligned: Story = {
  render: () => (
    <div className={`${s.flex} ${s.gap4}`}>
      {(['start', 'center', 'end'] as const).map((align) => (
        <Popover key={align}>
          <PopoverTrigger>
            <Button variant="ghost" size="sm">
              {align}
            </Button>
          </PopoverTrigger>
          <PopoverContent align={align}>
            <p className={s.textSm}>Aligned: {align}</p>
          </PopoverContent>
        </Popover>
      ))}
    </div>
  ),
};
