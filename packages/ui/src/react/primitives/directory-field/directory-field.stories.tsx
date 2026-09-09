import type { Meta, StoryObj } from '@storybook/react-vite';
import { DirectoryField } from './index';
import * as s from '@react/story-layout.css';

const meta: Meta<typeof DirectoryField> = {
  title: 'Primitives/DirectoryField',
  component: DirectoryField,
  parameters: { layout: 'centered' },
  render: (args) => (
    <div className={s.w96}>
      <DirectoryField {...args} />
    </div>
  ),
};

export default meta;
type Story = StoryObj<typeof DirectoryField>;

export const Placeholder: Story = {
  args: {
    placeholder: 'Select a directory',
    onClick: noop,
  },
};

export const WithPath: Story = {
  args: {
    path: '/Users/david/Documents/repos/emdash',
    onClick: noop,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    placeholder: 'Select a machine first',
    onClick: noop,
  },
};

export const Small: Story = {
  args: {
    size: 'sm',
    path: '~/repos/emdash',
    onClick: noop,
  },
};

export const Warning: Story = {
  args: {
    path: '/Volumes/read-only/project',
    tone: 'warning',
    onClick: noop,
  },
};

export const Invalid: Story = {
  args: {
    'aria-invalid': true,
    placeholder: 'Directory is required',
    onClick: noop,
  },
};

function noop() {}
