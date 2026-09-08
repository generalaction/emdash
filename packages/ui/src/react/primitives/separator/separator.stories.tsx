import { Separator } from '@react/primitives/separator';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx, cx } from '@styles/index';
import * as s from '@react/story-layout.css';
const meta: Meta = {
  title: 'Primitives/Separator',
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj;
export const Horizontal: Story = {
  render: () => (
    <div
      className={cx(
        s.w72,
        sx({
          display: 'flex',
          flexDirection: 'column',
          gap: '3',
        })
      )}
    >
      <span style={{ fontSize: 'var(--em-text-sm)' }}>Section one</span>
      <Separator />
      <span style={{ fontSize: 'var(--em-text-sm)' }}>Section two</span>
    </div>
  ),
};
export const Vertical: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        alignItems: 'center',
        gap: '3',
      })}
    >
      <span style={{ fontSize: 'var(--em-text-sm)' }}>Details</span>
      <Separator orientation="vertical" />
      <span style={{ fontSize: 'var(--em-text-sm)' }}>History</span>
      <Separator orientation="vertical" />
      <span style={{ fontSize: 'var(--em-text-sm)' }}>Settings</span>
    </div>
  ),
};
