import type { Meta, StoryObj } from '@storybook/react-vite';
import { Devicon } from './devicon';

const meta = {
  title: 'Components/Devicon',
  component: Devicon,
  parameters: { layout: 'centered' },
  args: {
    iconClass: 'devicon-typescript-plain colored',
    size: 24,
  },
} satisfies Meta<typeof Devicon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Decorative: Story = {};

export const Labeled: Story = {
  args: {
    label: 'TypeScript',
  },
};
