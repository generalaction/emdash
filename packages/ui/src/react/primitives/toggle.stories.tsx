import type { Meta, StoryObj } from '@storybook/react-vite';
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, BoldIcon, ItalicIcon } from 'lucide-react';
import React from 'react';
import { Surface } from './surface';
import { Toggle, ToggleGroup, ToggleGroupItem } from './toggle';
import * as s from '../story-layout.css';

const meta: Meta = {
  title: 'Primitives/Toggle',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

/** A standalone toggle — active state via data-pressed / aria-pressed. */
export const Standalone: Story = {
  render: () => (
    <div className={`${s.flex} ${s.flexWrap} ${s.itemsCenter} ${s.gap2}`}>
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
    <div className={`${s.bgSurfaceSunken} ${s.flex} ${s.flexCol} ${s.gap4} ${s.roundedXl} ${s.p4}`}>
      {(['sunken', 'base', 'base-emphasis', 'elevated', 'elevated-emphasis'] as const).map(
        (level) => (
          <Surface
            key={level}
            level={level}
            className={`bg-surface ${s.flex} ${s.flexWrap} ${s.itemsCenter} ${s.gap2} ${s.roundedLg} ${s.p3}`}
          >
            <span className={`${s.w36} ${s.textXs} ${s.textForegroundMuted}`}>{level}</span>
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
        )
      )}
    </div>
  ),
};
