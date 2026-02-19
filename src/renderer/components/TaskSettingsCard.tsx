import React from 'react';
import { useTaskSettings } from '../hooks/useTaskSettings';
import { AutoApproveByDefaultRow, AutoGenerateTaskNamesRow } from './TaskSettingsRows';

const TaskSettingsCard: React.FC = () => {
  const taskSettings = useTaskSettings();
  return (
    <div className="flex flex-col gap-4">
      <AutoGenerateTaskNamesRow taskSettings={taskSettings} />
      <AutoApproveByDefaultRow taskSettings={taskSettings} />
    </div>
  );
};

export default TaskSettingsCard;
