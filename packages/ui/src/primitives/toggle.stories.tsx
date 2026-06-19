import type { Meta, StoryObj } from '@storybook/react-vite';
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, BoldIcon, ItalicIcon } from 'lucide-react';
import React from 'react';
import { Toggle, ToggleGroup, ToggleGroupItem } from './toggle';
import { Surface } from './surface';

const meta: Meta = {
  title: 'Primitives/Toggle',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

/** A standalone toggle — active state via data-pressed / aria-pressed. */
export const Standalone: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Toggle aria-label="Bold">
        <BoldIcon />
      </Toggle>
      <Toggle aria-label="Italic">
        <ItalicIcon />
      </Toggle>
      <Toggle size="sm" aria-label="Bold sm">
        <BoldIcon />
      </Toggle>
    </div>
  ),
};

/** ToggleGroup with single selection (alignment). */
export const Group: Story = {
  render: () => (
    <ToggleGroup>
      <ToggleGroupItem value="left" aria-label="Align left">
        <AlignLeftIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="center" aria-label="Align center">
        <AlignCenterIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="right" aria-label="Align right">
        <AlignRightIcon />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
};

/** Active state across all surfaces. */
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
          <Toggle pressed aria-label="Bold pressed">
            <BoldIcon />
          </Toggle>
          <Toggle aria-label="Italic">
            <ItalicIcon />
          </Toggle>
          <ToggleGroup>
            <ToggleGroupItem value="left" aria-label="Left">
              <AlignLeftIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="center" aria-label="Center">
              <AlignCenterIcon />
            </ToggleGroupItem>
          </ToggleGroup>
        </Surface>
      ))}
    </div>
  ),
};
