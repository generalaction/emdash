import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx, cx } from '@styles/index';
import { SearchIcon, XIcon } from 'lucide-react';
import { InputGroup } from '.';
import { Icon } from '../icon';
import * as s from '@react/story-layout.css';
const meta: Meta = {
  title: 'Primitives/InputGroup',
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj;
export const WithLeadingIcon: Story = {
  render: () => (
    <div className={s.w72}>
      <InputGroup.Root>
        <InputGroup.Addon align="inline-start">
          <Icon source={SearchIcon} />
        </InputGroup.Addon>
        <InputGroup.Input placeholder="Search…" />
      </InputGroup.Root>
    </div>
  ),
};
export const WithTrailingButton: Story = {
  render: () => (
    <div className={s.w72}>
      <InputGroup.Root>
        <InputGroup.Input placeholder="Search…" />
        <InputGroup.Addon align="inline-end">
          <InputGroup.Button>
            <Icon source={XIcon} />
          </InputGroup.Button>
        </InputGroup.Addon>
      </InputGroup.Root>
    </div>
  ),
};
export const WithPrefixText: Story = {
  render: () => (
    <div className={s.w72}>
      <InputGroup.Root>
        <InputGroup.Addon align="inline-start">
          <InputGroup.Text>https://</InputGroup.Text>
        </InputGroup.Addon>
        <InputGroup.Input placeholder="example.com" />
      </InputGroup.Root>
    </div>
  ),
};
export const WithTextarea: Story = {
  render: () => (
    <div className={s.w72}>
      <InputGroup.Root>
        <InputGroup.Addon align="block-start">
          <InputGroup.Text>Note</InputGroup.Text>
        </InputGroup.Addon>
        <InputGroup.Textarea placeholder="Write something…" rows={3} />
      </InputGroup.Root>
    </div>
  ),
};
export const Invalid: Story = {
  render: () => (
    <div className={s.w72}>
      <InputGroup.Root invalid>
        <InputGroup.Addon align="inline-start">
          <Icon source={SearchIcon} />
        </InputGroup.Addon>
        <InputGroup.Input placeholder="Search…" aria-invalid="true" />
      </InputGroup.Root>
    </div>
  ),
};
export const StateMatrix: Story = {
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
      <InputGroup.Root tone="warning">
        <InputGroup.Addon align="inline-start">Warning</InputGroup.Addon>
        <InputGroup.Input defaultValue="Review this value" />
      </InputGroup.Root>
      <InputGroup.Root readOnly>
        <InputGroup.Input defaultValue="Readonly value" />
      </InputGroup.Root>
      <InputGroup.Root disabled>
        <InputGroup.Input defaultValue="Disabled value" />
        <InputGroup.Addon align="inline-end">
          <InputGroup.Button>Choose</InputGroup.Button>
        </InputGroup.Addon>
      </InputGroup.Root>
      <InputGroup.Root size="sm">
        <InputGroup.Input placeholder="Small group" />
      </InputGroup.Root>
    </div>
  ),
};
