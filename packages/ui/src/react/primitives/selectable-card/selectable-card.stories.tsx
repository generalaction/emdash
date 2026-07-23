import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { Box } from '../box';
import { SelectableCard } from './index';

const meta = {
  title: 'Primitives/SelectableCard',
  component: SelectableCard,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof SelectableCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Box display="flex" flexDirection="column" gap="3" padding="4">
      <SelectableCard padding="3" borderRadius="md">
        Normal
      </SelectableCard>
      <SelectableCard padding="3" borderRadius="md" selected>
        Selected
      </SelectableCard>
      <SelectableCard padding="3" borderRadius="md" interactive={false}>
        Non-interactive
      </SelectableCard>
    </Box>
  ),
};

export const OnSunkenCanvas: Story = {
  render: () => (
    <Box surface="sunken" display="flex" flexDirection="column" gap="3" padding="4">
      <SelectableCard padding="3" borderRadius="md">
        On sunken canvas
      </SelectableCard>
      <SelectableCard padding="3" borderRadius="md" selected>
        Selected on sunken canvas
      </SelectableCard>
    </Box>
  ),
};

export const Status: Story = {
  render: () => (
    <Box display="flex" flexDirection="column" gap="3" padding="4">
      <SelectableCard status="info" padding="3" borderRadius="md">
        Info
      </SelectableCard>
      <SelectableCard status="info" padding="3" borderRadius="md" selected>
        Info selected
      </SelectableCard>
    </Box>
  ),
};

export const Levels: Story = {
  render: () => (
    <Box display="flex" flexDirection="column" gap="3" padding="4">
      {(['sunken', 'base', 'elevated'] as const).map((level) => (
        <SelectableCard key={level} level={level} padding="3" borderRadius="md">
          Level: {level}
        </SelectableCard>
      ))}
    </Box>
  ),
};
