import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx, cx } from '@styles/index';
import { Input } from '.';
import * as s from '@react/story-layout.css';
const meta: Meta<typeof Input> = {
  title: 'Primitives/Input',
  component: Input,
  parameters: { layout: 'centered' },
  argTypes: {
    size: { control: 'select', options: ['base', 'sm'] },
    tone: {
      control: 'select',
      options: ['neutral', 'destructive', 'warning', 'info', 'success'],
    },
    disabled: { control: 'boolean' },
    placeholder: { control: 'text' },
  },
};
export default meta;
type Story = StoryObj<typeof Input>;
export const Default: Story = {
  render: () => (
    <div className={s.w64}>
      <Input placeholder="Enter text…" />
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
      <Input size="base" placeholder="Base (32 px)" />
      <Input size="sm" placeholder="Small (24 px)" />
    </div>
  ),
};
export const WithValue: Story = {
  render: () => (
    <div className={s.w64}>
      <Input defaultValue="Hello world" />
    </div>
  ),
};
export const Disabled: Story = {
  render: () => (
    <div className={s.w64}>
      <Input placeholder="Disabled" disabled />
    </div>
  ),
};
export const Readonly: Story = {
  render: () => (
    <div className={s.w64}>
      <Input defaultValue="Readonly value" readOnly />
    </div>
  ),
};
export const Invalid: Story = {
  render: () => (
    <div className={s.w64}>
      <Input placeholder="Invalid" aria-invalid="true" />
    </div>
  ),
};
export const Tones: Story = {
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
      <Input tone="warning" defaultValue="Warning" />
      <Input tone="info" defaultValue="Information" />
      <Input tone="success" defaultValue="Success" />
      <Input tone="destructive" defaultValue="Destructive" />
    </div>
  ),
};
export const Types: Story = {
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
      <Input type="text" placeholder="Text" />
      <Input type="email" placeholder="Email" />
      <Input type="password" placeholder="Password" />
      <Input type="number" placeholder="Number" />
      <Input type="search" placeholder="Search" />
    </div>
  ),
};
