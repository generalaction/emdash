import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useAppSettings } from '@/contexts/AppSettingsProvider';

const TaskHoverActionCard: React.FC = () => {
  const { settings, updateSettings, isLoading, isSaving } = useAppSettings();

  const value = settings?.interface?.taskHoverAction ?? 'delete';

  const handleChange = (next: 'delete' | 'archive') => {
    updateSettings({ interface: { taskHoverAction: next } });
    window.dispatchEvent(new CustomEvent('taskHoverActionChanged', { detail: { value: next } }));
  };

  return (
    <div id="task-hover-action-card" className="flex items-center justify-between gap-4">
      <div className="flex flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">Task hover action</p>
        <p className="text-sm text-muted-foreground">
          Primary action when hovering over tasks in the sidebar.
        </p>
      </div>
      <Select
        value={value}
        onValueChange={(next) => handleChange(next as 'delete' | 'archive')}
        disabled={isLoading || isSaving}
      >
        <SelectTrigger className="w-auto shrink-0 gap-2 [&>span]:line-clamp-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="delete">Delete</SelectItem>
          <SelectItem value="archive">Archive</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};

export default TaskHoverActionCard;
