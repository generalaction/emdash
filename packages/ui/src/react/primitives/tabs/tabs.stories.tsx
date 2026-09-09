import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx, sx } from '@styles/index';
import { surface } from '@styles/recipes/surface';
import { Tabs } from './tabs';
const meta: Meta = {
  title: 'Primitives/Tabs',
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj;
export const Default: Story = {
  render: () => (
    <Tabs.Root defaultValue="overview">
      <Tabs.List>
        <Tabs.Tab value="overview">Overview</Tabs.Tab>
        <Tabs.Tab value="details">Details</Tabs.Tab>
        <Tabs.Tab value="history">History</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel
        value="overview"
        className={cx(sx({ marginTop: '3', fontSize: 'sm', color: 'foregroundMuted' }))}
      >
        Overview content
      </Tabs.Panel>
      <Tabs.Panel
        value="details"
        className={cx(sx({ marginTop: '3', fontSize: 'sm', color: 'foregroundMuted' }))}
      >
        Details content
      </Tabs.Panel>
      <Tabs.Panel
        value="history"
        className={cx(sx({ marginTop: '3', fontSize: 'sm', color: 'foregroundMuted' }))}
      >
        History content
      </Tabs.Panel>
    </Tabs.Root>
  ),
};
export const Vertical: Story = {
  render: () => (
    <Tabs.Root defaultValue="overview" orientation="vertical">
      <Tabs.List aria-label="Sections">
        <Tabs.Tab value="overview">Overview</Tabs.Tab>
        <Tabs.Tab value="details">Details</Tabs.Tab>
        <Tabs.Tab value="history">History</Tabs.Tab>
      </Tabs.List>
    </Tabs.Root>
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
              flexDirection: 'column',
              gap: '2',
              rounded: 'lg',
              padding: '3',
            })
          )}
        >
          <span style={{ fontSize: 'var(--em-text-xs)', color: 'var(--em-foreground-muted)' }}>
            {level}
          </span>
          <Tabs.Root defaultValue="a">
            <Tabs.List>
              <Tabs.Tab value="a">Alpha</Tabs.Tab>
              <Tabs.Tab value="b">Beta</Tabs.Tab>
              <Tabs.Tab value="c">Gamma</Tabs.Tab>
            </Tabs.List>
          </Tabs.Root>
        </div>
      ))}
    </div>
  ),
};
