import { Meter } from '@react/primitives/meter';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta: Meta<typeof Meter> = {
  title: 'Primitives/Meter',
  component: Meter,
  args: { label: 'Capacity remaining', value: 65 },
  decorators: [
    (Story) => (
      <div style={{ width: 280 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof Meter>;
export const Default: Story = {};
export const Labeled: Story = {
  args: {
    startLabel: '30% left',
    endLabel: '↻ 6d 20h',
    value: 30,
  },
};
export const LabeledEmpty: Story = { args: { ...Labeled.args, value: 0, startLabel: '0% left' } };
export const LabeledFull: Story = {
  args: { ...Labeled.args, value: 100, startLabel: '100% left' },
};
