import React from 'react';
import {
  AutoApproveByDefaultRow,
  AutoGenerateTaskNamesRow,
  AutoTrustWorktreesRow,
} from './TaskSettingsRows';

const TaskSettingsCard: React.FC = () => {
  return (
    <div className="flex flex-col gap-4">
      <AutoGenerateTaskNamesRow />
      <AutoApproveByDefaultRow />
      <AutoTrustWorktreesRow />
    </div>
  );
};

export default TaskSettingsCard;
