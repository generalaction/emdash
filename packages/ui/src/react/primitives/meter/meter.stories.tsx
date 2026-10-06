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
