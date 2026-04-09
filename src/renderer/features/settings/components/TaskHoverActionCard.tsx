import React from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';

const TaskHoverActionCard: React.FC = () => {
  const { value: iface, update, isLoading, isSaving } = useAppSettingsKey('interface');

  const value = iface?.taskHoverAction ?? 'delete';

  const handleChange = (next: 'delete' | 'archive') => {
    update({ taskHoverAction: next });
    window.dispatchEvent(new CustomEvent('taskHoverActionChanged', { detail: { value: next } }));
  };

  return (
    <div className="flex items-center justify-between gap-4">
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
