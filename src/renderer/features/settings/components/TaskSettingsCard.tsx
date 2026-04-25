import React from 'react';
import { AutoGenerateTaskNamesRow, AutoTrustWorktreesRow } from './TaskSettingsRows';

const TaskSettingsCard: React.FC = () => {
  return (
    <div className="flex flex-col gap-4">
      <AutoGenerateTaskNamesRow />
      <AutoTrustWorktreesRow />
    </div>
  );
};

export default TaskSettingsCard;
