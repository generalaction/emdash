import { Kbd, KbdGroup } from '@react/primitives/kbd';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx, cx } from '@styles/index';
import * as s from '@react/story-layout.css';
const meta: Meta = {
  title: 'Primitives/Kbd',
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj;
export const Default: Story = {
  render: () => <Kbd>⌘</Kbd>,
};
export const Shortcut: Story = {
  render: () => (
    <div
      className={cx(
        s.w72,
        sx({
          display: 'flex',
          alignItems: 'center',
          gap: '2',
        })
      )}
    >
      <Kbd>⌘</Kbd>
      <Kbd>F</Kbd>
    </div>
  ),
};
export const Grouped: Story = {
  render: () => (
    <div
      className={cx(
        s.w72,
        sx({
          display: 'flex',
          alignItems: 'center',
          gap: '2',
        })
      )}
    >
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd>⇧</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
    </div>
  ),
};
