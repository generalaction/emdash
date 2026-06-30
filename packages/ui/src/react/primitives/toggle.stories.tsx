import type { Meta, StoryObj } from '@storybook/react-vite';
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, BoldIcon, ItalicIcon } from 'lucide-react';
import { Box } from './box';
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
    <Box display="flex" flexWrap="wrap" alignItems="center" gap="2">
      <Toggle aria-label="Bold">
        <BoldIcon />
      </Toggle>
      <Toggle aria-label="Italic">
        <ItalicIcon />
      </Toggle>
      <Toggle size="sm" aria-label="Bold sm">
        <BoldIcon />
      </Toggle>
    </Box>
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
    <Box
      background="surfaceSunken"
      display="flex"
      flexDirection="column"
      gap="4"
      rounded="xl"
      padding="4"
    >
      {(['sunken', 'base', 'base-emphasis', 'elevated', 'elevated-emphasis'] as const).map(
        (level) => (
          <Box
            key={level}
            surface={level}
            display="flex"
            flexWrap="wrap"
            alignItems="center"
            gap="2"
            rounded="lg"
            padding="3"
          >
            <span
              className={s.w36}
              style={{ fontSize: 'var(--text-xs)', color: 'var(--foreground-muted)' }}
            >
              {level}
            </span>
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
          </Box>
        )
      )}
    </Box>
  ),
};
