import React from 'react';
import { SkillsPanel } from '@core/features/skills/contributions/browser/SkillsPanel';

export const SkillsView: React.FC = () => (
  <SkillsPanel
    header={{
      title: 'Skills',
      description: 'Extend your agents with reusable skill modules',
    }}
  />
);
