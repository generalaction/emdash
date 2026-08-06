import React from 'react';
import { SkillsPanel } from './SkillsPanel';

export const SkillsView: React.FC = () => (
  <SkillsPanel
    header={{
      title: 'Skills',
      description: 'Extend your agents with reusable skill modules',
    }}
  />
);
