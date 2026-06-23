import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Surface } from './surface';
import { Tabs, TabsList, TabsPanel, TabsTab } from './tabs';

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
      <TabsPanel value="overview" className="mt-3 text-sm text-foreground-muted">
        Overview content
      </TabsPanel>
      <TabsPanel value="details" className="mt-3 text-sm text-foreground-muted">
        Details content
      </TabsPanel>
      <TabsPanel value="history" className="mt-3 text-sm text-foreground-muted">
        History content
      </TabsPanel>
    </Tabs>
  ),
};

/** Tabs on each surface level — hover/selected adapt via cascade. */
export const AcrossSurfaces: Story = {
  render: () => (
    <div className="bg-surface-sunken flex flex-col gap-4 rounded-xl p-4">
      {(['sunken', 'base', 'base-emphasis', 'elevated', 'elevated-emphasis'] as const).map(
        (level) => (
          <Surface
            key={level}
            level={level}
            className="bg-surface flex flex-col gap-2 rounded-lg p-3"
          >
            <span className="text-xs text-foreground-muted">{level}</span>
            <Tabs defaultValue="a">
              <TabsList>
                <TabsTab value="a">Alpha</TabsTab>
                <TabsTab value="b">Beta</TabsTab>
                <TabsTab value="c">Gamma</TabsTab>
              </TabsList>
            </Tabs>
          </Surface>
        )
      )}
    </div>
  ),
};
