import { Button } from '@react/primitives/button';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { EmptyState } from './empty-state';

const meta: Meta<typeof EmptyState> = {
  title: 'Components/EmptyState',
  component: EmptyState,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ height: '20rem', display: 'flex' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    label: 'No tasks yet',
  },
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {};

export const WithDescription: Story = {
  args: {
    label: 'No pull requests',
    description: 'Pull requests opened from this project will show up here.',
  },
};

export const WithAction: Story = {
  args: {
    label: 'No terminals open',
    description: 'Open a terminal to run commands in this workspace.',
    action: <Button variant="primary">New terminal</Button>,
  },
};
