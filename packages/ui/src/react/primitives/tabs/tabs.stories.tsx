import { Box } from '@react/primitives/box';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx } from '@styles/utilities/cx';
import { Tabs, TabsList, TabsPanel, TabsTab } from './tabs';
import { sx } from '@styles/utilities/sprinkles.css';

const meta: Meta = {
  title: 'Primitives/Tabs',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

/** Basic tabs — active tab driven by data-selected. */
export const Default: Story = {
  render: () => (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTab value="overview">Overview</TabsTab>
        <TabsTab value="details">Details</TabsTab>
        <TabsTab value="history">History</TabsTab>
      </TabsList>
      <TabsPanel
        value="overview"
        className={cx(sx({ marginTop: '3', fontSize: 'sm', color: 'foregroundMuted' }))}
      >
        Overview content
      </TabsPanel>
      <TabsPanel
        value="details"
        className={cx(sx({ marginTop: '3', fontSize: 'sm', color: 'foregroundMuted' }))}
      >
        Details content
      </TabsPanel>
      <TabsPanel
        value="history"
        className={cx(sx({ marginTop: '3', fontSize: 'sm', color: 'foregroundMuted' }))}
      >
        History content
      </TabsPanel>
    </Tabs>
  ),
};

/** Tabs on each surface level — hover/selected adapt via cascade. */
export const AcrossSurfaces: Story = {
  render: () => (
    <Box
      background="surfaceSunken"
      display="flex"
      flexDirection="column"
      gap="4"
      rounded="xl"
      padding="4"
    >
      {(['sunken', 'base', 'base-emphasis', 'elevated', 'elevated-emphasis'] as const).map(
        (level) => (
          <Box
            key={level}
            surface={level}
            display="flex"
            flexDirection="column"
            gap="2"
            rounded="lg"
            padding="3"
          >
            <span style={{ fontSize: 'var(--em-text-xs)', color: 'var(--em-foreground-muted)' }}>
              {level}
            </span>
            <Tabs defaultValue="a">
              <TabsList>
                <TabsTab value="a">Alpha</TabsTab>
                <TabsTab value="b">Beta</TabsTab>
                <TabsTab value="c">Gamma</TabsTab>
              </TabsList>
            </Tabs>
          </Box>
        )
      )}
    </Box>
  ),
};
