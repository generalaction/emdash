import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx, cx } from '@styles/index';
import { surface } from '@styles/recipes/surface';
import * as React from 'react';
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
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: '3',
        padding: '4',
      })}
    >
      <SelectableCard padding="3" borderRadius="lg">
        Normal
      </SelectableCard>
      <SelectableCard padding="3" borderRadius="lg" selected>
        Selected
      </SelectableCard>
      <SelectableCard padding="3" borderRadius="lg" interactive={false}>
        Non-interactive
      </SelectableCard>
      <SelectableCard padding="3" borderRadius="lg" selected interactive={false}>
        Selected non-interactive
      </SelectableCard>
    </div>
  ),
};
export const OnSunkenCanvas: Story = {
  render: () => (
    <div
      className={cx(
        surface({ level: 'sunken' }),
        sx({
          display: 'flex',
          flexDirection: 'column',
          gap: '3',
          padding: '4',
        })
      )}
    >
      <SelectableCard padding="3" borderRadius="lg">
        On sunken canvas
      </SelectableCard>
      <SelectableCard padding="3" borderRadius="lg" selected>
        Selected on sunken canvas
      </SelectableCard>
    </div>
  ),
};
export const Alignment: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: '3',
        padding: '4',
      })}
    >
      <SelectableCard padding="3" borderRadius="lg" justifyContent="flex-start">
        Aligned start
      </SelectableCard>
      <SelectableCard padding="3" borderRadius="lg" justifyContent="center">
        Aligned center
      </SelectableCard>
      <SelectableCard padding="3" borderRadius="lg" justifyContent="flex-end">
        Aligned end
      </SelectableCard>
    </div>
  ),
};
