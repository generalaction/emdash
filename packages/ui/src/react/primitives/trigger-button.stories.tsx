import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { Surface } from './surface';
import { TriggerButton } from './trigger-button';

const meta: Meta = {
  title: 'Primitives/TriggerButton',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

/** Bare TriggerButton — becomes "active" (surface-selected) while expanded. */
export const Bare: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <TriggerButton>Choose an option</TriggerButton>
      <TriggerButton size="sm">Small trigger</TriggerButton>
      <TriggerButton showChevron={false}>No chevron</TriggerButton>
    </div>
  ),
};

/** Select using SelectTrigger (wraps TriggerButton internally). */
export const AsSelectTrigger: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="Pick an option" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="a">Alpha</SelectItem>
        <SelectItem value="b">Beta</SelectItem>
        <SelectItem value="c">Gamma</SelectItem>
      </SelectContent>
    </Select>
  ),
};

/** Dropdown using TriggerButton as the trigger face. */
export const AsDropdownTrigger: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<TriggerButton className="w-48">Actions</TriggerButton>} />
      <DropdownMenuContent>
        <DropdownMenuItem>Edit</DropdownMenuItem>
        <DropdownMenuItem>Duplicate</DropdownMenuItem>
        <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

/** Active state across all surfaces. */
export const AcrossSurfaces: Story = {
  render: () => (
    <div className="bg-surface-sunken flex flex-col gap-4 rounded-xl p-4">
      {(['sunken', 'base', 'base-emphasis', 'elevated', 'elevated-emphasis'] as const).map(
        (level) => (
          <Surface
            key={level}
            level={level}
            className="bg-surface flex flex-wrap items-center gap-2 rounded-lg p-3"
          >
            <span className="w-36 text-xs text-foreground-muted">{level}</span>
            <Select>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a">Alpha</SelectItem>
                <SelectItem value="b">Beta</SelectItem>
              </SelectContent>
            </Select>
          </Surface>
        )
      )}
    </div>
  ),
};
