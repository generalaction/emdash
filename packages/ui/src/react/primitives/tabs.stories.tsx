import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Surface } from './surface';
import { Tabs, TabsList, TabsPanel, TabsTab } from './tabs';
import * as s from '../story-layout.css';

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
      <TabsPanel value="overview" className={`${s.mt3} ${s.textSm} ${s.textForegroundMuted}`}>
        Overview content
      </TabsPanel>
      <TabsPanel value="details" className={`${s.mt3} ${s.textSm} ${s.textForegroundMuted}`}>
        Details content
      </TabsPanel>
      <TabsPanel value="history" className={`${s.mt3} ${s.textSm} ${s.textForegroundMuted}`}>
        History content
      </TabsPanel>
    </Tabs>
  ),
};

/** Tabs on each surface level — hover/selected adapt via cascade. */
export const AcrossSurfaces: Story = {
  render: () => (
    <div className={`${s.bgSurfaceSunken} ${s.flex} ${s.flexCol} ${s.gap4} ${s.roundedXl} ${s.p4}`}>
      {(['sunken', 'base', 'base-emphasis', 'elevated', 'elevated-emphasis'] as const).map(
        (level) => (
          <Surface
            key={level}
            level={level}
            className={`bg-surface ${s.flex} ${s.flexCol} ${s.gap2} ${s.roundedLg} ${s.p3}`}
          >
            <span className={`${s.textXs} ${s.textForegroundMuted}`}>{level}</span>
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
