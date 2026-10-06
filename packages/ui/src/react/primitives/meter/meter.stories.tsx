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
export const Warning: Story = { args: { value: 20, tone: 'warning' } };
export const Exhausted: Story = { args: { value: 0, tone: 'error' } };
export const Full: Story = { args: { value: 100 } };
export const Subscription: Story = {
  args: {
    size: 'lg',
    startLabel: '30% left',
    endLabel: '↻ 6d 20h',
    value: 30,
  },
};
export const Labeled: Story = {
  args: {
    size: 'lg',
    color: 'var(--em-foreground)',
    striped: true,
    value: 95,
    startLabel: 'Codex 95%',
    endLabel: '↻ 6d 20h',
  },
};
export const Warm: Story = {
  args: {
    ...Labeled.args,
    color: '#D97757',
    value: 86,
    startLabel: 'Claude 86%',
    endLabel: '↻ 59m',
  },
};
export const LabeledEmpty: Story = { args: { ...Labeled.args, value: 0, startLabel: '0% left' } };
export const LabeledFull: Story = {
  args: { ...Labeled.args, value: 100, startLabel: '100% left' },
};
