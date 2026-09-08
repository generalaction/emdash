import { Icon } from '@react/primitives/icon';
import { Toggle, ToggleGroup } from '@react/primitives/toggle';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx, cx } from '@styles/index';
import { surface } from '@styles/recipes/surface';
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, BoldIcon, ItalicIcon } from 'lucide-react';
import * as s from '@react/story-layout.css';
const meta: Meta = {
  title: 'Primitives/Toggle',
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj;
export const Standalone: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '2',
      })}
    >
      <Toggle aria-label="Bold">
        <Icon source={BoldIcon} />
      </Toggle>
      <Toggle aria-label="Italic">
        <Icon source={ItalicIcon} />
      </Toggle>
      <Toggle size="xs" aria-label="Bold xs">
        <Icon source={BoldIcon} />
      </Toggle>
    </div>
  ),
};
export const Group: Story = {
  render: () => (
    <ToggleGroup.Root>
      <ToggleGroup.Item value="left" aria-label="Align left">
        <Icon source={AlignLeftIcon} />
      </ToggleGroup.Item>
      <ToggleGroup.Item value="center" aria-label="Align center">
        <Icon source={AlignCenterIcon} />
      </ToggleGroup.Item>
      <ToggleGroup.Item value="right" aria-label="Align right">
        <Icon source={AlignRightIcon} />
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  ),
};
export const AcrossSurfaces: Story = {
  render: () => (
    <div
      className={sx({
        background: 'surfaceSunken',
        display: 'flex',
        flexDirection: 'column',
        gap: '4',
        rounded: 'xl',
        padding: '4',
      })}
    >
      {(['sunken', 'base', 'raised', 'elevated', 'overlay'] as const).map((level) => (
        <div
          key={level}
          className={cx(
            surface({ level }),
            sx({
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '2',
              rounded: 'lg',
              padding: '3',
            })
          )}
        >
          <span
            className={s.w36}
            style={{ fontSize: 'var(--em-text-xs)', color: 'var(--em-foreground-muted)' }}
          >
            {level}
          </span>
          <Toggle pressed aria-label="Bold pressed">
            <Icon source={BoldIcon} />
          </Toggle>
          <Toggle aria-label="Italic">
            <Icon source={ItalicIcon} />
          </Toggle>
          <ToggleGroup.Root>
            <ToggleGroup.Item value="left" aria-label="Left">
              <Icon source={AlignLeftIcon} />
            </ToggleGroup.Item>
            <ToggleGroup.Item value="center" aria-label="Center">
              <Icon source={AlignCenterIcon} />
            </ToggleGroup.Item>
          </ToggleGroup.Root>
        </div>
      ))}
    </div>
  ),
};
