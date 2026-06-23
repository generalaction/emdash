import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { Badge } from './Badge';

const meta: Meta<typeof Badge> = {
  title: 'Solid/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'success', 'error'],
    },
  },
};
export default meta;

type Story = StoryObj<typeof Badge>;

export const Default: Story = {
  args: { variant: 'default', children: 'Badge' },
};

export const Success: Story = {
  args: { variant: 'success', children: 'Success' },
};

export const Error: Story = {
  args: { variant: 'error', children: 'Error' },
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
      <Badge variant="default">Default</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="error">Error</Badge>
    </div>
  ),
};
