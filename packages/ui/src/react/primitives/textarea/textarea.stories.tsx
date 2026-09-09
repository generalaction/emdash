import { Textarea } from '@react/primitives/textarea';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx, cx } from '@styles/index';
import * as s from '@react/story-layout.css';
const meta: Meta<typeof Textarea> = {
  title: 'Primitives/Textarea',
  component: Textarea,
  parameters: { layout: 'centered' },
  argTypes: {
    size: { control: 'select', options: ['base', 'sm'] },
    tone: {
      control: 'select',
      options: ['neutral', 'destructive', 'warning', 'info', 'success'],
    },
  },
};
export default meta;
type Story = StoryObj<typeof Textarea>;
export const Default: Story = {
  render: () => (
    <div className={s.w64}>
      <Textarea placeholder="Enter text…" />
    </div>
  ),
};
export const Sizes: Story = {
  render: () => (
    <div
      className={cx(
        s.w64,
        sx({
          display: 'flex',
          flexDirection: 'column',
          gap: '3',
        })
      )}
    >
      <Textarea size="base" placeholder="Base size textarea" />
      <Textarea size="sm" placeholder="Small size textarea" />
    </div>
  ),
};
export const WithValue: Story = {
  render: () => (
    <div className={s.w64}>
      <Textarea defaultValue="Some longer text that wraps over multiple lines in the textarea." />
    </div>
  ),
};
export const Disabled: Story = {
  render: () => (
    <div className={s.w64}>
      <Textarea placeholder="Disabled" disabled />
    </div>
  ),
};
export const Readonly: Story = {
  render: () => (
    <div className={s.w64}>
      <Textarea defaultValue="Readonly multiline value" readOnly />
    </div>
  ),
};
export const Invalid: Story = {
  render: () => (
    <div className={s.w64}>
      <Textarea placeholder="Invalid" aria-invalid="true" />
    </div>
  ),
};
export const Tone: Story = {
  render: () => (
    <div className={s.w64}>
      <Textarea tone="warning" defaultValue="Review this multiline value." />
    </div>
  ),
};
