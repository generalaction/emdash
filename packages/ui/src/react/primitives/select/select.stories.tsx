import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx, cx } from '@styles/index';
import { Select } from '.';
import * as s from '@react/story-layout.css';
const meta: Meta = {
  title: 'Primitives/Select',
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj;
export const Default: Story = {
  render: () => (
    <div className={s.w48}>
      <Select.Root>
        <Select.Trigger>
          <Select.Value placeholder="Pick a fruit" />
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="apple">Apple</Select.Item>
          <Select.Item value="banana">Banana</Select.Item>
          <Select.Item value="cherry">Cherry</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>
  ),
};
export const FormAppearance: Story = {
  render: () => (
    <div
      className={cx(
        s.w48,
        sx({
          display: 'flex',
          flexDirection: 'column',
          gap: '3',
        })
      )}
    >
      <Select.Root>
        <Select.Trigger appearance="input">
          <Select.Value placeholder="Default field trigger" />
        </Select.Trigger>
      </Select.Root>
      <Select.Root>
        <Select.Trigger appearance="input" size="sm" tone="warning">
          <Select.Value placeholder="Small warning trigger" />
        </Select.Trigger>
      </Select.Root>
      <Select.Root>
        <Select.Trigger appearance="input" aria-invalid>
          <Select.Value placeholder="Invalid trigger" />
        </Select.Trigger>
      </Select.Root>
    </div>
  ),
};
export const WithGroups: Story = {
  render: () => (
    <div className={s.w48}>
      <Select.Root>
        <Select.Trigger>
          <Select.Value placeholder="Pick a food" />
        </Select.Trigger>
        <Select.Content>
          <Select.Group>
            <Select.Label>Fruits</Select.Label>
            <Select.Item value="apple">Apple</Select.Item>
            <Select.Item value="banana">Banana</Select.Item>
          </Select.Group>
          <Select.Separator />
          <Select.Group>
            <Select.Label>Vegetables</Select.Label>
            <Select.Item value="carrot">Carrot</Select.Item>
            <Select.Item value="pea">Pea</Select.Item>
          </Select.Group>
        </Select.Content>
      </Select.Root>
    </div>
  ),
};
export const WithDefaultValue: Story = {
  render: () => (
    <div className={s.w48}>
      <Select.Root defaultValue="banana">
        <Select.Trigger>
          <Select.Value />
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="apple">Apple</Select.Item>
          <Select.Item value="banana">Banana</Select.Item>
          <Select.Item value="cherry">Cherry</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>
  ),
};
export const Disabled: Story = {
  render: () => (
    <div className={s.w48}>
      <Select.Root disabled>
        <Select.Trigger>
          <Select.Value placeholder="Disabled" />
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="apple">Apple</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>
  ),
};
export const WithDisabledItem: Story = {
  render: () => (
    <div className={s.w48}>
      <Select.Root>
        <Select.Trigger>
          <Select.Value placeholder="Pick a fruit" />
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="apple">Apple</Select.Item>
          <Select.Item value="banana" disabled>
            Banana (unavailable)
          </Select.Item>
          <Select.Item value="cherry">Cherry</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>
  ),
};
export const ContentSizing: Story = {
  render: () => (
    <div className={s.w48}>
      <Select.Root defaultValue="short">
        <Select.Trigger>
          <Select.Value />
        </Select.Trigger>
        <Select.Content width="content-at-least-trigger">
          <Select.Item value="short">Short</Select.Item>
          <Select.Item value="long">A much longer option that expands the popup</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>
  ),
};
